// Criteria translation (2026-08-29) — the other half of cross-language
// matching.
//
// A great deal of company information is written in English whatever the
// buyer's language, and the matcher reads a supplier's NAME and DESCRIPTOR as
// well as its description — those are English far more often than not, even
// for companies described in French: "Abbott Ball Company", "Auburn Bearing &
// Manufacturing", "AST Bearings". A French criterion cannot reach any of it.
// Add to that every supplier discovered by an English-language request, and
// any future discovery source that publishes in English.
//
// Storing supplier text in both languages (migration 0035) fixed one
// direction — an English request reaching French-discovered companies. This
// fixes the other: a FRENCH request reaching information that exists only in
// English.
//
// (Note for anyone tempted to cite the registries here: registry stores are
// VERIFICATION-role under ADR-001 and never enter matching, so Singapore's
// ~613k English activity descriptions are NOT what this buys. The reach it
// buys is over discovery-role text — names, descriptors, and global_web.)
//
// WHY TRANSLATE THE CRITERIA AND NOT THE POOL. Translating supplier text
// means every record in every discovery store, forever, growing. Translating
// criteria means a handful of short strings once per request, cached. Same
// capability, orders of magnitude less spend.
//
// WHY THE MODEL AND NOT A FREE TRANSLATION API (the owner asked, 2026-08-29:
// "AI or any free translation API available, we are optimizing cost" —
// clarified as MONEY, not latency). The arithmetic answers it:
//
//   - This call costs ~$0.0005 (batched, cheap model, ~150 in / ~60 out
//     tokens). A research pass costs ~$0.07 — 150× more. And the translation
//     memory below means each term is paid for ONCE, ever, across every
//     workspace, so the per-request figure trends to $0.
//   - A free API would therefore save at most ~$0.05 per hundred requests —
//     while risking the expensive failure. This is trade vocabulary, where
//     generic MT reliably slips: "joints toriques" → "toric joints" when the
//     industry says "O-rings"; "courroies transporteuses" → "transporting
//     belts" instead of "conveyor belts". And since the product criterion is
//     now a GATE, a wrong term does not rank a supplier lower — it makes them
//     invisible, empties the relevant set, and sends the request to live
//     research. One such miss costs ~$0.07: more than 150 translations.
//     The cheap option is the one that is right.
//   - It would also put a rate-limited third party on the critical path of
//     every request, for a saving that rounds to nothing.
//
// Failure is never fatal: a request whose translation fails keeps matching on
// its native values exactly as before.

import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { EXTRACTION_MODEL, getAnthropic } from "./client";

const TranslationSchema = z.object({
  /** Same length and order as the input. */
  translations: z.array(z.string()),
});

const SYSTEM = [
  "You translate short industrial sourcing terms into English for a supplier",
  "search engine. These are the words a buyer used to describe what they want",
  "to source.",
  "",
  "Use the term the INDUSTRY uses in English, not a literal translation — the",
  "output is matched against manufacturers' own website copy, so the trade name",
  "is what finds them:",
  '  "joints toriques" → "O-rings"        (not "toric joints")',
  '  "courroies transporteuses" → "conveyor belts"',
  '  "roulements à billes" → "ball bearings"',
  '  "vannes papillon" → "butterfly valves"',
  "",
  "Rules:",
  "- Return exactly one translation per input, in the same order.",
  "- Keep standards, grades and model numbers verbatim: ISO 9001, 316L, DN50,",
  "  FKM, ATEX. They are already international.",
  "- If a term is already English, return it unchanged.",
  "- Translate only. Never explain, expand or add synonyms.",
].join("\n");

/**
 * Translate short terms to English. Returns one string per input, in order;
 * on any failure returns nulls so the caller can fall back to native values.
 */
export async function translateToEnglish(values: string[]): Promise<(string | null)[]> {
  if (values.length === 0) return [];
  try {
    const client = getAnthropic();
    const response = await client.messages.parse({
      model: EXTRACTION_MODEL,
      max_tokens: 1000,
      system: SYSTEM,
      output_config: { format: zodOutputFormat(TranslationSchema) },
      messages: [
        {
          role: "user",
          content: values.map((value, index) => `${index + 1}. ${value}`).join("\n"),
        },
      ],
    });
    const out = response.parsed_output?.translations ?? [];
    // A model that returns the wrong number of lines has misunderstood the
    // task; taking a misaligned list would attach one criterion's translation
    // to another, which is worse than not translating at all.
    if (out.length !== values.length) {
      console.warn(
        `translate: expected ${values.length} translations, got ${out.length} — discarding`,
      );
      return values.map(() => null);
    }
    console.log(
      `translate: ${values.length} term(s) → EN ` +
        `(in=${response.usage.input_tokens}tok out=${response.usage.output_tokens}tok)`,
    );
    return out.map((t) => t.trim() || null);
  } catch (error) {
    // Never fatal — the request still matches on its native values.
    console.error("translate: failed, falling back to native values —", error);
    return values.map(() => null);
  }
}
