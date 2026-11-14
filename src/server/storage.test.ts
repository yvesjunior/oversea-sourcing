// The storage adapter's read side (2026-11-14). A `file` row can outlive its
// bytes, and the adapter must say so BEFORE the caller holds a stream: a
// download route that learns it mid-stream has already sent its headers and
// can only drop the connection.
//
// Runs on a throwaway directory — this is the local-disk adapter, so disk is
// the unit under test. UPLOAD_DIR is read at import, hence the dynamic import.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

let dir: string;
let storage: typeof import("@/server/storage");

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "osi-storage-"));
  process.env["UPLOAD_DIR"] = dir;
  storage = await import("@/server/storage");
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function readAll(stream: AsyncIterable<unknown>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

describe("reading a stored file", () => {
  it("gives back the bytes that were put, unchanged", async () => {
    // Every byte value, several times over — a text-mode or encoding slip
    // anywhere on the path shows up here.
    const bytes = Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 256));
    const key = await storage.putFile(bytes, "spec sheet.pdf");

    const stream = await storage.openFileStream(key);
    expect(stream).not.toBeNull();
    expect((await readAll(stream!)).equals(bytes)).toBe(true);
    expect((await storage.getFileBuffer(key))?.equals(bytes)).toBe(true);
  });

  it("answers null for a key whose bytes are gone — and logs the key", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const key = `${crypto.randomUUID()}/gone.pdf`;

    await expect(storage.openFileStream(key)).resolves.toBeNull();
    await expect(storage.getFileBuffer(key)).resolves.toBeNull();
    // The line is the only trace that a row has outlived its bytes.
    expect(logged).toHaveBeenCalledTimes(2);
    expect(String(logged.mock.calls[0]?.[0])).toContain(key);
  });

  it("answers null once a file has been deleted", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const key = await storage.putFile(Buffer.from("x"), "a.txt");
    await storage.deleteFile(key);

    await expect(storage.openFileStream(key)).resolves.toBeNull();
  });

  it("answers null for a key that lands on a directory", async () => {
    // A directory OPENS without complaint and fails on the first read — the
    // mid-stream failure, by another door.
    vi.spyOn(console, "error").mockImplementation(() => {});
    await mkdir(path.join(dir, "a-directory", "nested"), { recursive: true });

    await expect(storage.openFileStream("a-directory/nested")).resolves.toBeNull();
  });

  it("answers null when the key's first segment is a file, not a directory", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await writeFile(path.join(dir, "flat-file"), "x");

    await expect(storage.openFileStream("flat-file/name.pdf")).resolves.toBeNull();
  });

  it("still refuses a key that points outside the upload directory", async () => {
    // Not "missing": a key like this never came from putFile.
    await expect(storage.openFileStream("../outside.txt")).rejects.toThrow(/Invalid storage key/);
  });
});
