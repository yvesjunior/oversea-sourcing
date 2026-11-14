// File storage adapter (E3) — local-disk implementation behind an S3-shaped
// seam (README §4 — domain code never writes to local disk directly;
// swap this module's internals for R2/S3/MinIO without touching callers).

import { mkdir, open, unlink, writeFile } from "node:fs/promises";
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

/** Open a stored file for reading — `null` when its bytes are not there.
 *
 *  The file is opened HERE, before the caller holds a stream. A bare
 *  `createReadStream` only finds out on its first read that there is nothing
 *  to read, and by then a download route has sent its headers and can only
 *  drop the connection (2026-11-14: `/api/files/:id` answered nothing at all
 *  for a `file` row whose bytes were gone). Same shape as S3, where GetObject
 *  refuses a missing key before any body exists. */
export async function openFileStream(storageKey: string): Promise<Readable | null> {
  // Keys are server-generated UUIDs — resolve defensively anyway.
  const target = path.resolve(UPLOAD_DIR, storageKey);
  if (!target.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) {
    throw new Error(`Invalid storage key: ${storageKey}`);
  }
  let handle;
  try {
    handle = await open(target, "r");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // ENOTDIR: the key's <uuid> segment exists but is not a directory.
    if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
    logMissing(storageKey);
    return null;
  }
  // A directory opens fine and only fails on read — the very failure this
  // function exists to keep out of the caller's stream.
  if (!(await handle.stat()).isFile()) {
    await handle.close();
    logMissing(storageKey);
    return null;
  }
  // The stream owns the handle from here and closes it when it ends or dies.
  return handle.createReadStream();
}

/** Whoever recorded this key has outlived its bytes. Logged once, here, so
 *  no caller can forget to. For a user file it should not happen: the
 *  retention sweep (retention.ts) is the only thing that deletes one, and it
 *  takes the row with the bytes. */
function logMissing(storageKey: string): void {
  console.error(`storage: no bytes for key ${storageKey} — a record points at a file that is gone`);
}

/** Whole-file read, for callers that must hand the bytes to something else
 *  (E4 reads attachments so the AI can use what the buyer uploaded). `null`
 *  when the bytes are not there, as `openFileStream`. */
export async function getFileBuffer(storageKey: string): Promise<Buffer | null> {
  const stream = await openFileStream(storageKey);
  if (!stream) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
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
