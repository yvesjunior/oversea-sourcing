// Background worker — separate process, same image (doc/INFRA.md: one image,
// three processes: web, worker, migrate). Run with `npx tsx src/worker.ts`.
//
// One job: the request pipeline (received → searching → validating →
// report_ready). Criteria are parsed synchronously at intake (createRequestFn)
// — the pre-search AI analysis stage was removed 2026-08-05. A recovery sweep
// re-adopts requests stranded mid-pipeline (worker crash, lost enqueue,
// seeded mid-states).

import { PgBoss } from "pg-boss";
import { and, eq, inArray, lt } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import type { RequestStatus } from "@/database/schema";
import { QUEUES, type PipelineJob } from "@/server/queue";
import { transitionRequest } from "@/server/requests";
import { createMatchesForRequest } from "@/server/matching";

const STAGE_MS = 8_000;
const SWEEP_INTERVAL_MS = 60_000;
/** A request untouched this long in an in-flight state is considered stranded. */
const STRANDED_AFTER_MS = 2 * 60_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function loadRequest(requestId: string) {
  const row = await db.query.request.findFirst({
    where: eq(schema.request.id, requestId),
  });
  if (!row) throw new Error(`Request ${requestId} not found`);
  return row;
}

/** Resume-capable pipeline: picks the request up wherever it rests.
 *  ("analyzing" = legacy pre-removal pause state, still moved forward.) */
async function handlePipeline({ requestId }: PipelineJob): Promise<void> {
  const request = await loadRequest(requestId);
  const orgId = request.organizationId;
  let status: RequestStatus = request.status;

  if (status === "received" || status === "analyzing") {
    await transitionRequest(requestId, orgId, status, "searching");
    status = "searching";
    await sleep(STAGE_MS);
  }
  if (status === "searching") {
    const existing = await db.query.match.findFirst({
      where: eq(schema.match.requestId, requestId),
    });
    if (!existing) {
      const analyzed = await createMatchesForRequest(requestId, orgId);
      console.log(`pipeline: ${requestId} matched top suppliers from a pool of ${analyzed}`);
    }
    await transitionRequest(requestId, orgId, "searching", "validating");
    status = "validating";
    await sleep(STAGE_MS);
  }
  if (status === "validating") {
    await transitionRequest(requestId, orgId, "validating", "report_ready");
    return;
  }
  if (status !== "report_ready") {
    console.log(`pipeline: ${requestId} is ${status}, nothing to do`);
  }
}

/** Re-enqueue requests stranded in an in-flight state (crash recovery). The
 *  legacy "analyzing" pause is NOT swept — those wait for a manual launch. */
async function sweepStranded(enqueue: (requestId: string) => Promise<void>): Promise<void> {
  const cutoff = new Date(Date.now() - STRANDED_AFTER_MS);
  const stranded = await db.query.request.findMany({
    where: and(
      inArray(schema.request.status, ["received", "searching", "validating"]),
      lt(schema.request.updatedAt, cutoff),
    ),
  });
  for (const request of stranded) {
    console.log(`sweep: re-adopting ${request.id} (stranded in ${request.status})`);
    await enqueue(request.id);
  }
}

async function main() {
  const boss = new PgBoss(process.env["DATABASE_URL"] ?? "postgres://osi:osi@localhost:5432/osi");
  boss.on("error", (error) => console.error("pg-boss error:", error));
  await boss.start();
  await boss.createQueue(QUEUES.pipeline);

  const enqueue = async (requestId: string) => {
    await boss.send(QUEUES.pipeline, { requestId } satisfies PipelineJob);
  };

  // pg-boss v10+ hands each handler an ARRAY of jobs (batch size 1 by default).
  // Log failures ourselves before rethrowing — pg-boss stores the error on the
  // job (state: failed) but never writes it to stdout.
  await boss.work<PipelineJob>(QUEUES.pipeline, async (jobs) => {
    for (const job of jobs) {
      console.log(`pipeline: job ${job.id}`, job.data);
      try {
        await handlePipeline(job.data);
      } catch (error) {
        console.error(`pipeline: job ${job.id} FAILED —`, error);
        throw error; // rethrow so pg-boss retries
      }
    }
  });

  // Crash recovery: on boot and on an interval, re-adopt stranded requests.
  await sweepStranded(enqueue).catch((error) => console.error("sweep failed:", error));
  const sweepTimer = setInterval(() => {
    void sweepStranded(enqueue).catch((error) => console.error("sweep failed:", error));
  }, SWEEP_INTERVAL_MS);

  console.log(
    `worker: listening on ${QUEUES.pipeline} (intake parsing is synchronous; sweep every ${SWEEP_INTERVAL_MS / 1000}s)`,
  );

  const shutdown = async (signal: string) => {
    console.log(`worker: ${signal} received, stopping…`);
    clearInterval(sweepTimer);
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
