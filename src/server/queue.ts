// Background job queue (pg-boss, lives in Postgres — README §4 Architecture).
// Server-only: the web process enqueues here; src/worker.ts consumes.

import { PgBoss } from "pg-boss";

export const QUEUES = {
  pipeline: "request.pipeline",
} as const;

export type PipelineJob = { requestId: string };

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
