// AI gateway core — the ONLY module allowed to construct the Anthropic client
// (doc/INFRA.md §2: retries, model tiering and cost controls all live here).
// Server-only: reach this exclusively through dynamic imports or the worker.

import Anthropic from "@anthropic-ai/sdk";

/** Default model for extraction/chat — override with ANTHROPIC_MODEL. */
export const MODEL = process.env["ANTHROPIC_MODEL"] ?? "claude-haiku-4-5";

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
