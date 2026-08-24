// Background job queue (pg-boss, lives in Postgres — README §4 Architecture).
// Server-only: the web process enqueues here; src/worker.ts consumes.
//
// Two queues (validated 2026-08-22): `pipeline` is fast orchestration and
// matching; `research` is the slow, expensive collection work — isolated so a
// research burst can never starve status transitions. One worker consumes both
// by default; scaling out = a second worker container with WORKER_QUEUES=research
// (see src/worker.ts). All enqueues go through this seam — swapping pg-boss for
// a broker later touches this file, not domain code.

import { PgBoss } from "pg-boss";

export const QUEUES = {
  pipeline: "request.pipeline",
  research: "request.research",
} as const;

export type PipelineJob = { requestId: string };
export type ResearchJob = { requestId: string };
/** Admin "Mettre à jour" (C1): the source_run row is created by the server fn
 *  BEFORE enqueueing — the screen shows it as running immediately, and the
 *  worker owns only the collection. Rides the research queue on purpose: it is
 *  the same slow, Claude-bound work, and worker-research owns all collection. */
export type AdminRefreshJob = { sourceRunId: string };
export type ResearchQueueJob = ResearchJob | AdminRefreshJob;

let boss: PgBoss | null = null;
let started: Promise<PgBoss> | null = null;

export function getBoss(): Promise<PgBoss> {
  started ??= (async () => {
    boss = new PgBoss(process.env["DATABASE_URL"] ?? "postgres://osi:osi@localhost:5432/osi");
    await boss.start();
    return boss;
  })();
  return started;
}

/** pg-boss v10+ requires the queue to exist before send() — createQueue is idempotent. */
async function send(queue: string, data: object): Promise<void> {
  const instance = await getBoss();
  await instance.createQueue(queue);
  await instance.send(queue, data);
}

export async function enqueuePipeline(requestId: string): Promise<void> {
  await send(QUEUES.pipeline, { requestId } satisfies PipelineJob);
}

export async function enqueueResearch(requestId: string): Promise<void> {
  await send(QUEUES.research, { requestId } satisfies ResearchJob);
}

export async function enqueueAdminRefresh(sourceRunId: string): Promise<void> {
  await send(QUEUES.research, { sourceRunId } satisfies AdminRefreshJob);
}
