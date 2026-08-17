// Supplier research agent (E4) — "Recherche mondiale", literally.
//
// This module is the ONLY place in the codebase that performs a web search
// (doc/INFRA.md §2: the AI gateway owns every Claude call; principle 4: every
// provider sits behind a thin adapter). Search runs server-side inside the
// Claude API via the `web_search` tool, so there is no second vendor and no
// second key — swapping in Tavily/Brave later means rewriting `searchPhase`
// and nothing else.
//
// Two phases on purpose (doc/INFRA.md §4: "model tiering — cheap model for
// extraction, strong model for research"):
//   A. the strong model searches and reads, producing prose findings
//   B. a cheap model turns those findings into rows
// Splitting them also sidesteps the API's structured-output/citations
// conflict: web-search answers carry citations, which `output_config.format`
// rejects.

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { EXTRACTION_MODEL, getAnthropic, MODEL, RESEARCH_MODEL } from "./client";
import { estimateCost } from "./models";
import { RESEARCH_CANDIDATE_CAP, RESEARCH_SEARCHES } from "@/server/sourcing-config";

/** Both derived from SUPPLIERS_RETURNED — see src/server/sourcing-config.ts. */
const MAX_SEARCHES = RESEARCH_SEARCHES;
const MAX_CANDIDATES = RESEARCH_CANDIDATE_CAP;

/** `pause_turn` continuations before we take what we have (runaway guard). */
const MAX_CONTINUATIONS = 4;

/** Extra attempts after a transient failure. The SDK already retries twice at
 *  the HTTP layer; this covers blips that outlast that, which we saw drop a
 *  whole research pass. Bounded on purpose — a genuinely down API should fail
 *  fast and let the pipeline rank the existing pool, not stall every request. */
const RETRY_ATTEMPTS = 2;
const RETRY_BASE_MS = 1500;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Transient = worth another go: dropped connections, timeouts, rate limits,
 *  and 5xx. A 400 or a 401 is our bug or our config, and retrying just burns
 *  time to reach the same answer. */
function isTransient(error: unknown): boolean {
  if (error instanceof Anthropic.APIConnectionError) return true;
  if (error instanceof Anthropic.APIError) {
    return error.status === 429 || (typeof error.status === "number" && error.status >= 500);
  }
  return false;
}

async function withRetry<T>(label: string, run: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      return await run();
    } catch (error) {
      last = error;
      if (!isTransient(error) || attempt === RETRY_ATTEMPTS) break;
      const delay = RETRY_BASE_MS * 2 ** attempt;
      console.warn(
        `research/${label}: transient failure (${error instanceof Error ? error.message : String(error)}) ` +
          `— retry ${attempt + 1}/${RETRY_ATTEMPTS} in ${delay}ms`,
      );
      await wait(delay);
    }
  }
  throw last;
}

const CandidateSchema = z.object({
  name: z.string(),
  /** Short brand descriptor shown under the name ("Pumps", "Valves"). */
  descriptor: z.string().nullable(),
  /** ISO 3166-1 alpha-2, uppercase. */
  countryCode: z.string(),
  website: z.string().nullable(),
  /** One sentence on what they manufacture, in the buyer's language. */
  description: z.string().nullable(),
  /** Page the agent actually read this from — provenance for the buyer. */
  sourceUrl: z.string().nullable(),
  /** 0-100, how well the evidence supports this being a real, fitting supplier. */
  confidence: z.number(),
});

const CandidatesSchema = z.object({
  suppliers: z.array(CandidateSchema).max(MAX_CANDIDATES),
});

export type SupplierCandidate = z.infer<typeof CandidateSchema>;

export type ResearchContext = {
  title: string;
  descriptionRaw: string;
  locale: string;
  criteria: Array<{ category: string; label: string; value: string; unit: string | null }>;
  /** Text pulled out of the buyer's attachments (spec sheets, drawings). */
  attachmentText?: string;
};

export type ResearchResult = {
  candidates: SupplierCandidate[];
  /** Queries the agent ran — persisted on research_run for the audit trail. */
  queries: string[];
};

function brief(ctx: ResearchContext): string {
  const criteria = ctx.criteria
    .map((c) => `- ${c.label}: ${c.value}${c.unit ? ` ${c.unit}` : ""}`)
    .join("\n");
  const lines = [
    `Sourcing need: ${ctx.title}`,
    "",
    "Buyer's own words:",
    ctx.descriptionRaw,
    "",
    criteria ? `Structured criteria:\n${criteria}` : "No structured criteria were extracted.",
  ];
  if (ctx.attachmentText?.trim()) {
    lines.push(
      "",
      "From the documents the buyer attached (these are the authoritative",
      "specifications — prefer them over the free-text description where they",
      "disagree):",
      ctx.attachmentText.trim(),
    );
  }
  return lines.join("\n");
}

const RESEARCH_SYSTEM = [
  "You are OSI's supplier research analyst. OSI is a facilitated marketplace for",
  "industrial sourcing: buyers describe a need, you find real manufacturers who",
  "can meet it anywhere in the world.",
  "",
  "Search the web for companies that actually manufacture or supply what the buyer",
  "describes. Prefer manufacturers over distributors and marketplaces. Look beyond",
  "the buyer's own region — global coverage is the product.",
  "",
  "For every company you propose, report: the legal or trading name, the country",
  "(ISO 3166-1 alpha-2), the website, one sentence on what they make that fits this",
  "need, and the page you read it from.",
  "",
  "Rules:",
  "- Only report companies you actually found on a page you read. Never invent a",
  "  company, a website, or a certification.",
  "- Say so explicitly when the evidence is thin, rather than padding the list.",
  `- Stop at ${MAX_CANDIDATES} companies.`,
  "- Skip directories, aggregators, and marketplace listings themselves — they are",
  "  a route to suppliers, not suppliers.",
].join("\n");

const EXTRACTION_SYSTEM = [
  "Convert the research findings below into structured supplier records.",
  "Copy only what the findings state — never infer a country, a website, or a",
  "specialism that is not written there. Drop any company whose country you",
  "cannot determine. countryCode must be ISO 3166-1 alpha-2, uppercase.",
  "confidence reflects how well the findings evidence that company: 80+ when a",
  "manufacturer page states the capability, 50-70 when it is implied, below 50",
  "when it is a guess.",
].join("\n");

/** Phase A — the strong model searches and reads. Returns prose + the queries run. */
async function searchPhase(ctx: ResearchContext): Promise<{ findings: string; queries: string[] }> {
  const client = getAnthropic();
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: brief(ctx) }];

  // Written as a branch rather than a computed `type` so each arm is a literal
  // the SDK's tool union can check — the registry picks which arm we take.
  const searchTool: Anthropic.ToolUnion =
    RESEARCH_MODEL.searchTool === "web_search_20260209"
      ? { type: "web_search_20260209", name: "web_search", max_uses: MAX_SEARCHES }
      : { type: "web_search_20250305", name: "web_search", max_uses: MAX_SEARCHES };

  const queries: string[] = [];
  let findings = "";

  for (let attempt = 0; attempt <= MAX_CONTINUATIONS; attempt++) {
    // Retried per turn, not per pass: a blip on continuation 3 must not throw
    // away the searches already paid for on turns 1 and 2.
    const response = await withRetry("search", () =>
      client.messages.create({
        model: MODEL,
        max_tokens: 8000,
        system: RESEARCH_SYSTEM,
        tools: [searchTool],
        messages,
      }),
    );

    for (const block of response.content) {
      if (block.type === "text") findings += block.text;
      // Record what was actually searched — `server_tool_use` carries the query.
      if (block.type === "server_tool_use" && block.name === "web_search") {
        const query = (block.input as { query?: string } | null)?.query;
        if (query) queries.push(query);
      }
    }

    // This is platform hotspot #1 (doc/INFRA.md §4) — log enough to tell a
    // rate limit from a truncation from a model that just went quiet, and
    // enough to see the bill move when someone switches tier.
    const cost = estimateCost(RESEARCH_MODEL, {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
      searches: queries.length,
    });
    console.log(
      `research/search: model=${RESEARCH_MODEL.id} turn ${attempt + 1} ` +
        `stop=${response.stop_reason} ` +
        `blocks=[${response.content.map((b) => b.type).join(",")}] ` +
        `queries=${queries.length} findings=${findings.length}c ` +
        `in=${response.usage.input_tokens}tok out=${response.usage.output_tokens}tok ` +
        `est=${cost === null ? "n/a" : `$${cost.toFixed(3)}`}`,
    );

    // Server-side tools run inside the response; only `pause_turn` needs us to
    // hand the turn back so the server can resume where it left off.
    if (response.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: response.content });
  }

  return { findings: findings.trim(), queries };
}

/** Phase B — the cheap model turns prose into rows. */
async function extractPhase(findings: string, locale: string): Promise<SupplierCandidate[]> {
  const client = getAnthropic();
  // Worth retrying hardest: the searches are already paid for, so losing this
  // step to a blip throws away the whole pass for the price of one cheap call.
  const response = await withRetry("extract", () =>
    client.messages.parse({
      model: EXTRACTION_MODEL,
      max_tokens: 4000,
      system: `${EXTRACTION_SYSTEM}\nWrite descriptions in ${locale === "en" ? "English" : "French"}.`,
      output_config: { format: zodOutputFormat(CandidatesSchema) },
      messages: [{ role: "user", content: findings }],
    }),
  );
  return response.parsed_output?.suppliers ?? [];
}

/**
 * Research suppliers for one request. Returns candidates as found — dedup,
 * scoring and persistence are the caller's job (src/server/research.ts), so
 * this module stays a pure gateway.
 */
export async function researchSuppliers(ctx: ResearchContext): Promise<ResearchResult> {
  const { findings, queries } = await searchPhase(ctx);
  if (!findings) return { candidates: [], queries };

  const candidates = await extractPhase(findings, ctx.locale);
  console.log(
    `research/extract: ${findings.length}c of findings → ${candidates.length} candidates`,
  );
  return { candidates, queries };
}
