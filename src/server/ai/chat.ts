// Per-request AI chat (E3) — conversational refinement with optional criteria
// mutations, returned as structured operations in a single round-trip.

import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { CRITERIA_CATEGORIES } from "@/database/schema";
import { getAnthropic, MODEL } from "./client";

const ChatResponseSchema = z.object({
  reply: z.string(),
  operations: z
    .array(
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
    )
    .max(8),
});

export type ChatOperation = z.infer<typeof ChatResponseSchema>["operations"][number];
export type ChatResult = { reply: string; operations: ChatOperation[] };

export type ChatContext = {
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
  history: Array<{ role: "user" | "assistant"; content: string }>;
  userMessage: string;
};

function systemPrompt(ctx: ChatContext): string {
  const lang = ctx.locale === "en" ? "English" : "French";
  return [
    "You are the sourcing assistant of OSI (Oversea Sourcing Intelligence). You help a buyer",
    "refine the criteria of one sourcing request before the global supplier search launches.",
    "",
    `Request #${ctx.title}`,
    `Buyer's original need: ${ctx.descriptionRaw}`,
    "",
    "Current criteria (JSON):",
    JSON.stringify(ctx.criteria),
    "",
    "Rules:",
    "- Answer the buyer's message in `reply`, briefly and concretely.",
    "- When the buyer asks to change requirements, express the change in `operations`",
    "  (add/update/remove referencing criterion ids above); otherwise return an empty array.",
    "- Never invent specifications the buyer did not give or confirm.",
    `- Reply in ${lang}.`,
  ].join("\n");
}

/** Refusal or unparsable output degrades to a reply-only fallback. */
export async function chatAboutRequest(ctx: ChatContext): Promise<ChatResult> {
  const client = getAnthropic();
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 2048,
    system: systemPrompt(ctx),
    output_config: { format: zodOutputFormat(ChatResponseSchema) },
    messages: [
      ...ctx.history.map((m) => ({ role: m.role, content: m.content })),
      { role: "user" as const, content: ctx.userMessage },
    ],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) {
    const fallback =
      ctx.locale === "en"
        ? "I can't help with that request. Could you rephrase it in terms of your sourcing need?"
        : "Je ne peux pas répondre à cette demande. Pouvez-vous la reformuler en lien avec votre besoin de sourcing ?";
    return { reply: fallback, operations: [] };
  }
  return response.parsed_output;
}
