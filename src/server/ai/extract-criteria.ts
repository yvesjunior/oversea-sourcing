// AI criteria extraction (E3) — free-text sourcing need → structured criteria.

import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { CRITERIA_CATEGORIES, type CriteriaCategory } from "@/database/schema";
import { getAnthropic, MODEL } from "./client";

export type ExtractedCriterion = {
  category: CriteriaCategory;
  label: string;
  value: string;
  unit: string | null;
  required: boolean;
};

const ExtractionSchema = z.object({
  criteria: z
    .array(
      z.object({
        category: z.enum(CRITERIA_CATEGORIES),
        label: z.string(),
        value: z.string(),
        unit: z.string().nullable(),
        required: z.boolean(),
      }),
    )
    .max(12),
});

function systemPrompt(locale: string): string {
  const lang = locale === "en" ? "English" : "French";
  return [
    "You are the sourcing-criteria extraction engine of OSI (Oversea Sourcing Intelligence),",
    "an industrial sourcing platform. A buyer describes a need in free text; you extract the",
    "structured, verifiable sourcing criteria a procurement engineer would use to shortlist",
    "suppliers.",
    "",
    "Rules:",
    "- Extract only what the text states or clearly implies; never invent specifications.",
    "- category: material | flow | pressure | certification | quantity | lead_time | other.",
    "- label: short criterion name; value: the requirement itself; unit: measurement unit or null.",
    "- required: true when the buyer presents it as a hard constraint.",
    "- 3 to 12 criteria, most important first.",
    `- Write labels and values in ${lang}.`,
  ].join("\n");
}

/** Returns [] when the model refuses or the output cannot be parsed. */
export async function extractCriteria(
  descriptionRaw: string,
  locale: string,
): Promise<ExtractedCriterion[]> {
  const client = getAnthropic();
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 2048,
    system: systemPrompt(locale),
    output_config: { format: zodOutputFormat(ExtractionSchema) },
    messages: [{ role: "user", content: descriptionRaw }],
  });
  if (response.stop_reason === "refusal" || !response.parsed_output) return [];
  return response.parsed_output.criteria;
}
