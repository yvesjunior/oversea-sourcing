// Background worker — separate process, same image (README §4 — one image, three
// processes: web, worker, migrate). Run with `npx tsx src/worker.ts`.
//
// Two queues (validated 2026-08-22): `pipeline` (orchestration, matching, the
// recovery sweep) and `research` (source collection — slow, expensive,
// rate-limited by the Claude API). WORKER_QUEUES selects what this process
// consumes (default: both, so one container still runs everything). Scaling
// out = a second container with WORKER_QUEUES=research and this one set to
// pipeline — replicas are the scaling knob for the one hotspot.
//
// Store-first (validated 2026-08-22): the pipeline checks whether the sources'
// stores already answer the request; research is enqueued only when they
// don't. A warm category costs ≈ $0 and never touches the research queue.

import { PgBoss } from "pg-boss";
import { and, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import type { RequestStatus } from "@/database/schema";
import {
  QUEUES,
  type PipelineJob,
  type ResearchJob,
  type ResearchQueueJob,
  type VerifyJob,
} from "@/server/queue";
import { recordEvent, transitionRequest } from "@/server/requests";
import { createMatchesForRequest } from "@/server/matching";
import { researchEnabled } from "@/server/ai/flags";
import { evaluateStoreCoverage, runAdminRefresh, runResearchForRequest } from "@/server/research";

const STAGE_MS = 8_000;
const SWEEP_INTERVAL_MS = 60_000;
/** A request untouched this long in an in-flight state is considered stranded. */
const STRANDED_AFTER_MS = 2 * 60_000;

/** Which queues THIS process consumes — the container-split knob. */
const SERVED_QUEUES = (process.env["WORKER_QUEUES"] ?? "pipeline,research")
  .split(",")
  .map((q) => q.trim())
  .filter((q): q is keyof typeof QUEUES => q in QUEUES);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function loadRequest(requestId: string) {
  const row = await db.query.request.findFirst({
    where: eq(schema.request.id, requestId),
  });
  if (!row) throw new Error(`Request ${requestId} not found`);
  return row;
}

type Enqueue = (queue: string, data: object) => Promise<void>;

/** Resume-capable pipeline: picks the request up wherever it rests.
 *  ("analyzing" = legacy pre-removal pause state, still moved forward.) */
async function handlePipeline({ requestId }: PipelineJob, enqueue: Enqueue): Promise<void> {
  const request = await loadRequest(requestId);
  const orgId = request.organizationId;
  let status: RequestStatus = request.status;

  if (status === "received" || status === "analyzing") {
    await transitionRequest(requestId, orgId, status, "searching");
    status = "searching";
  }
  if (status === "searching") {
    const existing = await db.query.match.findFirst({
      where: eq(schema.match.requestId, requestId),
    });
    if (!existing) {
      // Give the criteria their English form BEFORE store-first and matching:
      // both need it, because most company information out there is listed in
      // English and a French criterion alone cannot reach it. Cached, cheap,
      // and failure-tolerant — a failure just means native-only matching.
      const { ensureCriteriaTranslated } = await import("@/server/criteria-translation");
      await ensureCriteriaTranslated(requestId, request.locale);
      const coverage = await evaluateStoreCoverage(requestId, orgId);
      if (researchEnabled()) {
        const priorRun = await db.query.researchRun.findFirst({
          where: eq(schema.researchRun.requestId, requestId),
        });
        if (!priorRun && !coverage.sufficient) {
          // Store answer insufficient → hand off to the research queue and
          // stop; the research worker re-enqueues the pipeline when done.
          // (A stranded-window sweep re-enqueues the pipeline, not research —
          // runResearchForRequest's own guard keeps duplicates cheap.)
          console.log(
            `pipeline: ${requestId} store insufficient (${coverage.qualifying} qualifying of ${coverage.poolSize}) — enqueueing research`,
          );
          await enqueue(QUEUES.research, { requestId } satisfies ResearchJob);
          return;
        }
        if (!priorRun && coverage.sufficient) {
          // The store answers — no collection, no tokens, no research queue.
          await recordEvent(requestId, orgId, "research.store_hit", {
            qualifying: coverage.qualifying,
            pool: coverage.poolSize,
          });
          console.log(
            `pipeline: ${requestId} store hit — ${coverage.qualifying} qualifying candidates, no research needed`,
          );
        }
      } else {
        await sleep(STAGE_MS);
      }
      // Re-resolve eligibility AFTER any research so new records are in scope.
      const scoped = await evaluateStoreCoverage(requestId, orgId);
      const analyzed = await createMatchesForRequest(requestId, orgId, {
        candidates: scoped.candidates,
      });
      console.log(`pipeline: ${requestId} matched top suppliers from a pool of ${analyzed}`);
      // ADR-001 §4: every presented supplier gets the verification battery.
      // Async on the research queue — the report never waits on a slow
      // website; evidence and the derived tier land seconds later.
      await enqueue(QUEUES.research, { verifyRequestId: requestId } satisfies VerifyJob);
    }
    await transitionRequest(requestId, orgId, "searching", "validating");
    status = "validating";
    await sleep(STAGE_MS);
  }
  if (status === "validating") {
    await transitionRequest(requestId, orgId, "validating", "report_ready");
    // E9: the buyer should not have to keep the tab open to learn the result.
    // created_by is null when the creator's account was deleted (UC-6
    // re-interpretation) — the dossier still finishes, nobody to notify.
    if (!request.createdBy) return;
    const { notifyUser } = await import("@/server/notify");
    const link = `/demandes/${requestId}`;
    await notifyUser({
      userId: request.createdBy,
      organizationId: orgId,
      type: "report_ready",
      params: { id: requestId },
      link,
      email: {
        subjectFr: `Votre rapport OSI #${requestId} est prêt`,
        subjectEn: `Your OSI report #${requestId} is ready`,
        bodyFr: `Votre recherche de fournisseurs est terminée — le rapport de la demande #${requestId} est disponible.\nConsultez-le : ${process.env["BETTER_AUTH_URL"] ?? "http://localhost:3010"}${link}`,
        bodyEn: `Your supplier search is complete — the report for request #${requestId} is available.\nView it: ${process.env["BETTER_AUTH_URL"] ?? "http://localhost:3010"}${link}`,
      },
    });
    return;
  }
  if (status !== "report_ready") {
    console.log(`pipeline: ${requestId} is ${status}, nothing to do`);
  }
}

/** Research jobs collect from the effective sources, then hand back to the
 *  pipeline queue to match and finish. Idempotent via research_run. Admin
 *  refreshes (C1) ride the same queue — same slow Claude-bound collection —
 *  but settle their own source_run and hand off to no one. */
async function handleResearch(job: ResearchQueueJob, enqueue: Enqueue): Promise<void> {
  if ("sourceRunId" in job) {
    await runAdminRefresh(job.sourceRunId);
    return;
  }
  if ("verifyRequestId" in job) {
    const { runVerificationForRequest } = await import("@/server/verification");
    await runVerificationForRequest(job.verifyRequestId);
    return;
  }
  const { requestId } = job;
  const request = await loadRequest(requestId);
  await runResearchForRequest(requestId, request.organizationId);
  await enqueue(QUEUES.pipeline, { requestId } satisfies PipelineJob);
}

/** Re-enqueue requests stranded in an in-flight state (crash recovery). The
 *  legacy "analyzing" pause is NOT swept — those wait for a manual launch. */
async function sweepStranded(enqueue: Enqueue): Promise<void> {
  const cutoff = new Date(Date.now() - STRANDED_AFTER_MS);
  const stranded = await db.query.request.findMany({
    where: and(
      inArray(schema.request.status, ["received", "searching", "validating"]),
      lt(schema.request.updatedAt, cutoff),
    ),
  });
  for (const request of stranded) {
    console.log(`sweep: re-adopting ${request.id} (stranded in ${request.status})`);
    await enqueue(QUEUES.pipeline, { requestId: request.id } satisfies PipelineJob);
  }
}

async function main() {
  const boss = new PgBoss(process.env["DATABASE_URL"] ?? "postgres://osi:osi@localhost:5432/osi");
  boss.on("error", (error) => console.error("pg-boss error:", error));
  await boss.start();
  for (const name of Object.values(QUEUES)) await boss.createQueue(name);

  const enqueue: Enqueue = async (queue, data) => {
    await boss.send(queue, data);
  };

  // pg-boss v10+ hands each handler an ARRAY of jobs (batch size 1 by default).
  // Log failures ourselves before rethrowing — pg-boss stores the error on the
  // job (state: failed) but never writes it to stdout.
  if (SERVED_QUEUES.includes("pipeline")) {
    await boss.work<PipelineJob>(QUEUES.pipeline, async (jobs) => {
      for (const job of jobs) {
        console.log(`pipeline: job ${job.id}`, job.data);
        try {
          await handlePipeline(job.data, enqueue);
        } catch (error) {
          console.error(`pipeline: job ${job.id} FAILED —`, error);
          throw error; // rethrow so pg-boss retries
        }
      }
    });
  }
  if (SERVED_QUEUES.includes("research")) {
    await boss.work<ResearchQueueJob>(QUEUES.research, async (jobs) => {
      for (const job of jobs) {
        console.log(`research: job ${job.id}`, job.data);
        try {
          await handleResearch(job.data, enqueue);
        } catch (error) {
          console.error(`research: job ${job.id} FAILED —`, error);
          throw error;
        }
      }
    });
  }

  // Crash recovery: on boot and on an interval, re-adopt stranded requests.
  // Only the pipeline worker sweeps — two sweepers would double-enqueue.
  let sweepTimer: ReturnType<typeof setInterval> | null = null;
  if (SERVED_QUEUES.includes("pipeline")) {
    await sweepStranded(enqueue).catch((error) => console.error("sweep failed:", error));
    sweepTimer = setInterval(() => {
      void sweepStranded(enqueue).catch((error) => console.error("sweep failed:", error));
    }, SWEEP_INTERVAL_MS);
  }

  console.log(
    `worker: listening on [${SERVED_QUEUES.join(", ")}]` +
      (sweepTimer ? ` (sweep every ${SWEEP_INTERVAL_MS / 1000}s)` : " (no sweep — research-only)"),
  );

  const shutdown = async (signal: string) => {
    console.log(`worker: ${signal} received, stopping…`);
    if (sweepTimer) clearInterval(sweepTimer);
    await boss.stop();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error) => {
  console.error("worker: fatal", error);
  process.exit(1);
});
