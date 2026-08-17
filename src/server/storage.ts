// File storage adapter (E3) — local-disk implementation behind an S3-shaped
// seam (doc/INFRA.md §2: "never write to local disk directly" from domain code;
// swap this module's internals for R2/S3/MinIO without touching callers).

import { createReadStream } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";

const UPLOAD_DIR = process.env["UPLOAD_DIR"] ?? "/data/uploads";

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
}
