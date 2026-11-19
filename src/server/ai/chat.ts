// The clarification before launch (Phase V · V18) — the model call.
//
// One round-trip: the draft and its criteria go in, a restatement, questions
// and PROPOSED criteria operations come out. Nothing here writes a criterion,
// and nothing here decides to run: `src/server/clarification.ts` calls this
// when a buyer asks, and stores what comes back as proposals.
//
// This replaces the E3 chat (`chatAboutRequest`), which was never switched on
// anywhere. It answered free-form and its operations were applied as returned.

import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { CRITERIA_CATEGORIES } from "@/database/schema";
import type { ModelTier } from "@/database/schema";
import type { RawOperation } from "@/lib/clarification";
import { getAnthropic } from "./client";
import { estimateCost } from "./models";
import { searchModelFor } from "./research";

const ClarificationSchema = z.object({
  /** The need, restated in two or three sentences. */
  restatement: z.string(),
  /** What a supplier would have to ask before quoting. */
  questions: z.array(z.string()),
  operations: z.array(
    z.object({
      op: z.enum(["add", "update", "remove"]),
      /** id of the existing criterion for update/remove; null for add */
      id: z.string().nullable(),
      category: z.enum(CRITERIA_CATEGORIES).nullable(),
      label: z.string().nullable(),
      value: z.string().nullable(),
      unit: z.string().nullable(),
      required: z.boolean().nullable(),
    }),
  ),
});

export type ClarificationOutput = {
  restatement: string;
  questions: string[];
  operations: RawOperation[];
};

export type ClarificationContext = {
  title: string;
  descriptionRaw: string;
  locale: string;
  criteria: Array<{
    id: string;
    category: string;
    label: string;
    value: string;
    unit: string | null;
    required: boolean;
  }>;
  /** Basics no criterion carries yet (`absentBasics`). */
  absent: string[];
  /** Proposals from earlier turns the buyer has not answered yet. */
  waiting: string[];
  /** Proposals from earlier turns the buyer declined. */
  declined: string[];
  /** Earlier turns of this clarification, oldest first. */
  history: Array<{ role: "user" | "assistant"; content: string }>;
  /** The buyer's answer; null when they only asked for a reading. */
  userMessage: string | null;
  /** The workspace plan's tier — the plan decides what a request may cost.
   *  Null when no plan applies: the platform's own model, as for the search. */
  modelTier: ModelTier | null;
};

function systemPrompt(ctx: ClarificationContext): string {
  const lang = ctx.locale === "en" ? "English" : "French";
  return [
    "You work for OSI (Oversea Sourcing Intelligence), a sourcing service. A buyer has drafted a",
    "request and has not launched it yet. Once launched, the text and the criteria below are what",
    "OSI searches suppliers with and what suppliers are asked to quote against — so anything",
    "vague or missing now becomes a wrong supplier or an unusable quote later. The buyer asked you",
    "to read the draft before that happens.",
    "",
    `Draft: ${ctx.title}`,
    "The buyer's own words:",
    ctx.descriptionRaw,
    "",
    "Criteria already recorded (JSON). These rows, not the prose, are what the search uses:",
    JSON.stringify(ctx.criteria),
    "",
    ctx.absent.length > 0
      ? `No criterion carries these basics yet: ${ctx.absent.join(", ")}. A supplier cannot quote without them, so ask for each one the buyer has not given you.`
      : "The basics (quantity, lead time) are recorded.",
    ...(ctx.waiting.length > 0
      ? [
          "",
          "Already proposed and waiting for the buyer's answer — do not propose these again:",
          ...ctx.waiting.map((line) => `- ${line}`),
        ]
      : []),
    ...(ctx.declined.length > 0
      ? [
          "",
          "Proposed earlier and declined by the buyer — they said no, so do not bring these back:",
          ...ctx.declined.map((line) => `- ${line}`),
        ]
      : []),
    "",
    "What to return:",
    "- `restatement`: the need as you understand it, in two or three plain sentences, so the buyer",
    "  can see at a glance whether you read it right.",
    "- `questions`: what a supplier would need to know before quoting and that the draft does not",
    "  say. Ask only what matters for this product, the most important first, five at most. If",
    "  nothing is missing, return an empty list rather than inventing a question.",
    "- `operations`: changes to the criteria that follow from what the buyer WROTE — in the draft",
    "  or in an answer during this conversation. `add` a criterion the text states but no row",
    "  records; `update` a row (by its id) that the buyer corrected or made more precise; `remove`",
    "  a row (by its id) the buyer withdrew. Leave a field null when it does not change.",
    "  `required` means a supplier that cannot meet the point is out: set it to true only where",
    "  the buyer presented the point as non-negotiable, and leave it null on a row whose",
    "  obligation the buyer did not mention.",
    "",
    "The buyer reviews every operation and accepts or declines it, and an accepted one is sent to",
    "suppliers as the buyer's requirement. So propose only what the buyer actually said: a",
    "quantity, a standard or a tolerance you find plausible but that they never gave is a question",
    "to ask, not an operation to propose.",
    "",
    `Write the restatement, the questions, and every label and value in ${lang}.`,
  ].join("\n");
}

/** What the buyer's side of the first turn says when they only pressed the
 *  button. Never stored: the API needs a user message to answer, the
 *  transcript does not need a sentence nobody typed. */
function opening(locale: string): string {
  return locale === "en"
    ? "Please read my draft: tell me how you understand it and what is missing."
    : "Merci de relire mon brouillon : dites-moi comment vous le comprenez et ce qui manque.";
}

/**
 * Ask the model to read the draft. Returns null when it declined or returned
 * something unusable — a paid turn that produced nothing, which the caller
 * tells the buyer instead of showing half an answer. Throws on a transport or
 * configuration failure (no key, rate limit, outage): nothing was produced
 * and the caller does not count the turn.
 */
export async function clarifyRequest(
  ctx: ClarificationContext,
): Promise<ClarificationOutput | null> {
  const client = getAnthropic();
  // The same rule as the supplier search, from the same function.
  const spec = searchModelFor(ctx.modelTier);
  const response = await client.messages.parse({
    model: spec.id,
    // A ceiling, not a target: the answer is a few hundred tokens, but on the
    // tiers that think by default the thinking is counted here too.
    max_tokens: 8000,
    system: systemPrompt(ctx),
    output_config: { format: zodOutputFormat(ClarificationSchema) },
    messages: [
      { role: "user" as const, content: opening(ctx.locale) },
      ...ctx.history.map((m) => ({ role: m.role, content: m.content })),
      ...(ctx.userMessage ? [{ role: "user" as const, content: ctx.userMessage }] : []),
    ],
  });

  const cost = estimateCost(spec, {
    input: response.usage.input_tokens,
    output: response.usage.output_tokens,
    searches: 0,
  });
  console.log(
    `clarify: model=${spec.id} stop=${response.stop_reason} ` +
      `in=${response.usage.input_tokens} out=${response.usage.output_tokens}` +
      (cost === null ? "" : ` ~$${cost.toFixed(4)}`),
  );

  if (response.stop_reason !== "end_turn" || !response.parsed_output) return null;
  return response.parsed_output;
}
