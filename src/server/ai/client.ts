// AI gateway core — the ONLY module allowed to construct the Anthropic client
// (doc/INFRA.md §2: retries, model tiering and cost controls all live here).
// Server-only: reach this exclusively through dynamic imports or the worker.

import Anthropic from "@anthropic-ai/sdk";
import { resolveResearchModel } from "./models";

/** Resolved from ANTHROPIC_MODEL, which accepts a tier (cheap | balanced | best)
 *  or a raw model id — see src/server/ai/models.ts for the registry. */
export const RESEARCH_MODEL = resolveResearchModel(process.env["ANTHROPIC_MODEL"]);

/** Reasoning model id — supplier research (E4), chat. */
export const MODEL = RESEARCH_MODEL.id;

/** Model tiering (doc/INFRA.md §4): turning prose into rows does not need the
 *  strong model. Override with ANTHROPIC_EXTRACTION_MODEL. */
export const EXTRACTION_MODEL = process.env["ANTHROPIC_EXTRACTION_MODEL"] ?? "claude-haiku-4-5";

/** Raised when ANTHROPIC_API_KEY is missing — callers degrade gracefully. */
export class AiConfigError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY is not set (put it in .env.local)");
    this.name = "AiConfigError";
  }
}

let client: Anthropic | null = null;

export function getAnthropic(): Anthropic {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) throw new AiConfigError();
  client ??= new Anthropic({ apiKey });
  return client;
}
