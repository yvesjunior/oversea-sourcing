// Shared tooling for FILE-FED connectors (registry-qc, registry-jp):
// landing a staff upload in a workdir, streaming ZIP extraction, and
// stream-parsing CSVs with encoding sniffing.

import { createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import { Unzip, UnzipInflate } from "fflate";
import { CsvParser } from "@/server/sources/csv";

/** Decode a sample strictly as UTF-8; fall back to windows-1252 when the
 *  file predates UTF-8 exports (accents would otherwise arrive as
 *  replacement chars and poison names and dedup keys). */
export function pickDecoder(sample: Uint8Array): TextDecoder {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample);
    return new TextDecoder("utf-8");
  } catch {
    return new TextDecoder("windows-1252");
  }
}

/** Stream a staff upload from the uploads volume into the workdir. */
export async function landUpload(fileKey: string, targetPath: string): Promise<void> {
  const { getFileStream } = await import("@/server/storage");
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(targetPath);
    getFileStream(fileKey)
      .on("error", reject)
      .pipe(out)
      .on("finish", () => resolve())
      .on("error", reject);
  });
}

/** True when the file starts with the ZIP magic ("PK"). */
export async function isZip(filePath: string): Promise<boolean> {
  const { open } = await import("node:fs/promises");
  const handle = await open(filePath, "r");
  try {
    const { buffer } = await handle.read(Buffer.alloc(2), 0, 2, 0);
    return buffer[0] === 0x50 && buffer[1] === 0x4b;
  } finally {
    await handle.close();
  }
}

/** Extract the entries a predicate wants from a ZIP to the out dir,
 *  streaming — entry order in the archive is never assumed, so callers
 *  extract first and parse after. Returns entry basename → extracted path. */
export async function extractEntries(
  zipPath: string,
  wanted: (entryBasename: string) => boolean,
  outDir: string,
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  await new Promise<void>((resolve, reject) => {
    const unzip = new Unzip();
    unzip.register(UnzipInflate);
    let pending = 0;
    let readDone = false;
    const finishMaybe = () => {
      if (readDone && pending === 0) resolve();
    };
    unzip.onfile = (file) => {
      const base = path.basename(file.name);
      if (!wanted(base)) return;
      const target = path.join(outDir, base);
      found.set(base, target);
      const out = createWriteStream(target);
      pending++;
      file.ondata = (err, chunk, final) => {
        if (err) {
          out.destroy();
          reject(err);
          return;
        }
        if (chunk) out.write(Buffer.from(chunk));
        if (final) {
          out.end(() => {
            pending--;
            finishMaybe();
          });
        }
      };
      file.start();
    };
    const stream = createReadStream(zipPath);
    stream.on("data", (chunk: string | Buffer) => {
      unzip.push(Buffer.isBuffer(chunk) ? new Uint8Array(chunk) : Buffer.from(chunk), false);
    });
    stream.on("end", () => {
      unzip.push(new Uint8Array(0), true);
      readDone = true;
      finishMaybe();
    });
    stream.on("error", reject);
  });
  return found;
}

/** Stream-parse a CSV file with encoding sniffing; rows via callback. */
export async function parseCsvFile(
  filePath: string,
  onRow: (row: string[]) => void,
): Promise<void> {
  const parser = new CsvParser(onRow);
  let decoder: TextDecoder | null = null;
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk: string | Buffer) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      decoder ??= pickDecoder(bytes.subarray(0, Math.min(bytes.length, 65536)));
      parser.write(decoder.decode(bytes, { stream: true }));
    });
    stream.on("end", () => {
      if (decoder) parser.write(decoder.decode());
      parser.end();
      resolve();
    });
    stream.on("error", reject);
  });
}
