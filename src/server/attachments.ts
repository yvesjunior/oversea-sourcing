// Attachment reading (E4) — turns what the buyer uploaded into text the rest
// of the pipeline can use: criteria parsing at intake, and the research brief.
//
// A sourcing need often lives in a spec sheet or a drawing rather than in the
// textarea. Storing that file and never opening it means the search runs on a
// one-line description while the real requirements sit unread on disk.
//
// Plain text and CSV are decoded directly — no tokens spent. PDFs and images
// go to Claude, which reads both natively; that call uses the cheap extraction
// model, since transcribing a document is not a reasoning task.

import { asc, eq } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import { EXTRACTION_MODEL, getAnthropic } from "@/server/ai/client";
import { getFileBuffer } from "@/server/storage";

/** Files read per request — a buyer attaching 20 drawings should not cost 20x. */
const MAX_FILES = 5;
/** Bytes per file handed to the model. Larger files are skipped, not truncated:
 *  half a spec sheet is worse than none, because it reads as complete. */
const MAX_BYTES = 5 * 1024 * 1024;
/** Cap on the text handed downstream, so one document cannot swamp the brief. */
const MAX_TEXT = 6000;

const TEXT_MIMES = new Set(["text/plain", "text/csv"]);
const IMAGE_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);
const PDF_MIME = "application/pdf";

export type AttachmentReadResult = {
  /** Extracted content, empty when there was nothing readable. */
  text: string;
  /** Files actually read. */
  read: string[];
  /** Files we could not read, with the reason — surfaced in the logs. */
  skipped: Array<{ filename: string; reason: string }>;
};

const TRANSCRIBE_PROMPT = [
  "These documents were attached to an industrial sourcing request.",
  "Transcribe only what a sourcing analyst would need: the product or component,",
  "materials and grades, quantified specifications with their units (pressure,",
  "flow, dimensions, tolerances), required certifications and standards,",
  "quantities, and delivery or lead-time requirements.",
  "",
  "Write plain text. Do not summarise, comment, or add anything that is not in",
  "the documents. If a document contains none of the above, write nothing for it.",
].join("\n");

/**
 * Read every attachment on a request and return their combined content.
 *
 * Never throws: an unreadable attachment degrades to a `skipped` entry, because
 * the request must still be able to run on its description alone.
 */
export async function readAttachmentsText(requestId: string): Promise<AttachmentReadResult> {
  const rows = await db
    .select({
      filename: schema.file.filename,
      mime: schema.file.mime,
      size: schema.file.size,
      storageKey: schema.file.storageKey,
    })
    .from(schema.requestAttachment)
    .innerJoin(schema.file, eq(schema.requestAttachment.fileId, schema.file.id))
    .where(eq(schema.requestAttachment.requestId, requestId))
    .orderBy(asc(schema.requestAttachment.createdAt))
    .limit(MAX_FILES);

  const result: AttachmentReadResult = { text: "", read: [], skipped: [] };
  if (rows.length === 0) return result;

  const parts: string[] = [];
  // Collected and sent as ONE request — a buyer attaching a drawing plus its
  // spec sheet means they belong together, and the model reads them as a set.
  const binaryBlocks: unknown[] = [];
  const binaryNames: string[] = [];

  for (const row of rows) {
    if (row.size > MAX_BYTES) {
      result.skipped.push({ filename: row.filename, reason: "over 5 MB" });
      continue;
    }

    let bytes: Buffer;
    try {
      bytes = await getFileBuffer(row.storageKey);
    } catch (error) {
      result.skipped.push({ filename: row.filename, reason: `unreadable (${String(error)})` });
      continue;
    }

    if (TEXT_MIMES.has(row.mime)) {
      parts.push(`--- ${row.filename} ---\n${bytes.toString("utf8")}`);
      result.read.push(row.filename);
      continue;
    }

    if (row.mime === PDF_MIME) {
      binaryBlocks.push({
        type: "document",
        source: { type: "base64", media_type: PDF_MIME, data: bytes.toString("base64") },
      });
      binaryNames.push(row.filename);
      continue;
    }

    if (IMAGE_MIMES.has(row.mime)) {
      binaryBlocks.push({
        type: "image",
        source: { type: "base64", media_type: row.mime, data: bytes.toString("base64") },
      });
      binaryNames.push(row.filename);
      continue;
    }

    // Office formats are zipped XML — neither we nor the model can read them
    // as-is. Converting them is a separate job (E4 import pipeline territory).
    result.skipped.push({ filename: row.filename, reason: `unsupported type ${row.mime}` });
  }

  if (binaryBlocks.length > 0) {
    try {
      const client = getAnthropic();
      const response = await client.messages.create({
        model: EXTRACTION_MODEL,
        max_tokens: 2000,
        messages: [
          {
            role: "user",
            content: [...binaryBlocks, { type: "text", text: TRANSCRIBE_PROMPT }] as never,
          },
        ],
      });
      const transcribed = response.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("")
        .trim();
      if (transcribed) {
        parts.push(`--- ${binaryNames.join(", ")} ---\n${transcribed}`);
        result.read.push(...binaryNames);
      } else {
        for (const name of binaryNames) {
          result.skipped.push({ filename: name, reason: "nothing sourcing-related found" });
        }
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      for (const name of binaryNames) {
        result.skipped.push({ filename: name, reason: `read failed (${reason})` });
      }
    }
  }

  result.text = parts.join("\n\n").slice(0, MAX_TEXT);
  return result;
}
