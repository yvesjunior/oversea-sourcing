// Background worker — separate process, same image (doc/INFRA.md: one image,
// three processes: web, worker, migrate). Run with `npx tsx src/worker.ts`.

import { PgBoss } from "pg-boss";
import { eq } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import { QUEUES, type ExtractCriteriaJob, type PipelineJob } from "@/server/queue";
import { recordEvent, transitionRequest } from "@/server/requests";
import { AiConfigError } from "@/server/ai/client";
import { promptAnalysisEnabled } from "@/server/ai/flags";
import { extractCriteria, type ExtractedCriterion } from "@/server/ai/extract-criteria";
import { fallbackExtractCriteria } from "@/server/ai/fallback-extract";
import { createMatchesForRequest } from "@/server/matching";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function loadRequest(requestId: string) {
  const row = await db.query.request.findFirst({
    where: eq(schema.request.id, requestId),
  });
  if (!row) throw new Error(`Request ${requestId} not found`);
  return row;
}

/** received → analyzing, Claude extraction, criteria rows, criteria.extracted event.
 *  Retry-safe: a failed attempt leaves the request in "analyzing" with no
 *  criteria — the retry resumes extraction instead of skipping. */
async function handleExtractCriteria({ requestId }: ExtractCriteriaJob): Promise<void> {
  const request = await loadRequest(requestId);
  if (request.status !== "received" && request.status !== "analyzing") {
    console.log(`extract-criteria: ${requestId} is ${request.status}, skipping`);
    return;
  }
  const existing = await db.query.requestCriterion.findFirst({
    where: eq(schema.requestCriterion.requestId, requestId),
  });
  if (existing) {
    console.log(`extract-criteria: ${requestId} already has criteria, skipping`);
    return;
  }
  if (request.status === "received") {
    await transitionRequest(requestId, request.organizationId, "received", "analyzing");
  }

  let criteria: ExtractedCriterion[];
  if (!promptAnalysisEnabled()) {
    // AI prompt analysis disabled (default): zero-token heuristic criteria,
    // request continues straight to supplier search below.
    criteria = fallbackExtractCriteria(request.descriptionRaw, request.locale);
  } else {
    try {
      criteria = await extractCriteria(request.descriptionRaw, request.locale);
    } catch (error) {
      if (!(error instanceof AiConfigError)) throw error;
      // No API key configured — deterministic heuristics keep the loop real.
      console.warn(
        `extract-criteria: ${requestId} — no ANTHROPIC_API_KEY, using heuristic fallback`,
      );
      criteria = fallbackExtractCriteria(request.descriptionRaw, request.locale);
    }
  }
  if (criteria.length > 0) {
    await db.insert(schema.requestCriterion).values(
      criteria.map((criterion, index) => ({
        id: crypto.randomUUID(),
        requestId,
        category: criterion.category,
        label: criterion.label,
        value: criterion.value,
        unit: criterion.unit,
        required: criterion.required,
        source: "ai" as const,
        position: index,
      })),
    );
  }
  await recordEvent(requestId, request.organizationId, "criteria.extracted", {
    count: criteria.length,
  });
  await db
    .update(schema.request)
    .set({ updatedAt: new Date() })
    .where(eq(schema.request.id, requestId));

  // Without prompt analysis there is no review pause — go straight to the
  // supplier search. With analysis on, PIPELINE_AUTOLAUNCH can still skip it.
  if (!promptAnalysisEnabled() || process.env["PIPELINE_AUTOLAUNCH"] === "true") {
    const { enqueuePipeline } = await import("@/server/queue");
    await enqueuePipeline(requestId);
  }
}

/** Pipeline: analyzing → searching (real matches from the supplier pool) →
 *  validating → report_ready. The web research agent (E4) will feed the pool;
 *  the scoring heuristic lives in src/server/matching.ts until E5. */
async function handlePipeline({ requestId }: PipelineJob): Promise<void> {
  const request = await loadRequest(requestId);
  if (request.status !== "analyzing") {
    console.log(`pipeline: ${requestId} is ${request.status}, skipping`);
    return;
  }
  const orgId = request.organizationId;
  await transitionRequest(requestId, orgId, "analyzing", "searching");
  await sleep(8_000);
  const analyzed = await createMatchesForRequest(requestId, orgId);
  console.log(`pipeline: ${requestId} matched top suppliers from a pool of ${analyzed}`);
  await transitionRequest(requestId, orgId, "searching", "validating");
  await sleep(8_000);
  await transitionRequest(requestId, orgId, "validating", "report_ready");
}

async function main() {
  const boss = new PgBoss(process.env["DATABASE_URL"] ?? "postgres://osi:osi@localhost:5432/osi");
  boss.on("error", (error) => console.error("pg-boss error:", error));
  await boss.start();

  await boss.createQueue(QUEUES.extractCriteria);
  await boss.createQueue(QUEUES.pipeline);

  // pg-boss v10+ hands each handler an ARRAY of jobs (batch size 1 by default).
  // Log failures ourselves before rethrowing — pg-boss stores the error on the
  // job (state: failed) but never writes it to stdout.
  const logged = <T>(name: string, handler: (data: T) => Promise<void>) => {
    return async (jobs: Array<{ id: string; data: T }>) => {
      for (const job of jobs) {
        console.log(`${name}: job ${job.id}`, job.data);
        try {
          await handler(job.data);
        } catch (error) {
          console.error(`${name}: job ${job.id} FAILED —`, error);
          throw error; // rethrow so pg-boss retries
        }
      }
    };
  };
  await boss.work<ExtractCriteriaJob>(
    QUEUES.extractCriteria,
    logged("extract-criteria", handleExtractCriteria),
  );
  await boss.work<PipelineJob>(QUEUES.pipeline, logged("pipeline", handlePipeline));

  console.log(
    `worker: listening on ${QUEUES.extractCriteria}, ${QUEUES.pipeline} ` +
      `(prompt-analysis: ${promptAnalysisEnabled() ? `ON, model ${process.env["ANTHROPIC_MODEL"] ?? "claude-haiku-4-5"}` : "off — heuristic, direct to search"})`,
  );

  const shutdown = async (signal: string) => {
    console.log(`worker: ${signal} received, stopping…`);
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
