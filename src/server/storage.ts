// File storage adapter (E3) — local-disk implementation behind an S3-shaped
// seam (README §4 — domain code never writes to local disk directly;
// swap this module's internals for R2/S3/MinIO without touching callers).

import { createReadStream } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";

const UPLOAD_DIR = process.env["UPLOAD_DIR"] ?? "/data/uploads";

/** Persist a stream without buffering it — big files (registry ZIPs run to
 *  hundreds of MB) must never sit whole in the web process's memory. */
export async function putFileStream(
  data: ReadableStream<Uint8Array>,
  filename: string,
): Promise<string> {
  const { createWriteStream } = await import("node:fs");
  const { Readable } = await import("node:stream");
  const { pipeline } = await import("node:stream/promises");
  const safeName = path.basename(filename).replace(/[^\w.-]+/g, "_") || "file";
  const key = `${crypto.randomUUID()}/${safeName}`;
  const target = path.join(UPLOAD_DIR, key);
  await mkdir(path.dirname(target), { recursive: true });
  await pipeline(Readable.fromWeb(data as never), createWriteStream(target));
  return key;
}

/** Persist bytes; returns the opaque storage key recorded in the DB. */
export async function putFile(data: Buffer, filename: string): Promise<string> {
  // Key layout: <uuid>/<sanitized-name> — unique, keeps the extension for tooling.
  const safeName = path.basename(filename).replace(/[^\w.-]+/g, "_") || "file";
  const key = `${crypto.randomUUID()}/${safeName}`;
  const target = path.join(UPLOAD_DIR, key);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, data);
  return key;
}

export function getFileStream(storageKey: string): Readable {
  // Keys are server-generated UUIDs — resolve defensively anyway.
  const target = path.resolve(UPLOAD_DIR, storageKey);
  if (!target.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) {
    throw new Error(`Invalid storage key: ${storageKey}`);
  }
  return createReadStream(target);
}

/** Whole-file read, for callers that must hand the bytes to something else
 *  (E4 reads attachments so the AI can use what the buyer uploaded). */
export async function getFileBuffer(storageKey: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of getFileStream(storageKey)) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function deleteFile(storageKey: string): Promise<void> {
  const target = path.resolve(UPLOAD_DIR, storageKey);
  if (!target.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) return;
  await unlink(target).catch(() => {});
  // Keys are <uuid>/<name> — drop the per-file dir too (rmdir refuses
  // non-empty dirs, so this can never take anything else with it).
  const { rmdir } = await import("node:fs/promises");
  await rmdir(path.dirname(target)).catch(() => {});
}
