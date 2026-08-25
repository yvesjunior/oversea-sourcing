// Token normalization shared by the matcher (scoring) and the store scope
// (C2b SQL prefilter) — one vocabulary, or the prefilter would drop records
// the scorer could have matched. Pure and client-safe.

/** Units and filler that carry no matching signal. */
const NOISE = new Set([
  "de",
  "du",
  "des",
  "le",
  "la",
  "les",
  "et",
  "ou",
  "en",
  "un",
  "une",
  "pour",
  "avec",
  "sous",
  "par",
  "an",
  "the",
  "and",
  "or",
  "for",
  "with",
  "per",
  "year",
  "of",
  "mm",
  "cm",
  "bar",
  "kg",
  "kn",
  "mois",
  "jours",
  "jour",
  "days",
  "weeks",
  "semaines",
  "units",
  "unites",
  "unités",
  "pieces",
  "pièces",
  "pcs",
  "m3",
  "h",
]);

export function normalizeText(input: string): string {
  return input.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Morphological variants that mean the same thing (A8 field evidence,
 *  2026-08-22: "inox" failed to match "inoxydable" and forced a research pass
 *  over a warm store). Applied to BOTH sides, so direction never matters. */
export const TOKEN_ALIASES: Record<string, string> = {
  inoxydable: "inox",
  stainless: "inox",
};

export function tokens(input: string): string[] {
  return normalizeText(input)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !NOISE.has(token))
    .map((token) => TOKEN_ALIASES[token] ?? token);
}

/**
 * The token variants the SQL prefilter should try against record NAMES for a
 * set of criteria values: normalized tokens plus their alias inverses and the
 * raw accented forms (SQL ILIKE does not strip accents — "genie" would miss
 * "GÉNIE MÉCANIQUE" without the raw variant). Prefilter tokens must be ≥ 3
 * characters: a 2-char token like "CE" substring-matches half a registry
 * ("laCErte", "oCEan") while token-equality scoring would reject every one —
 * pure load for zero signal.
 */
export function criteriaSearchTokens(values: string[]): string[] {
  const out = new Set<string>();
  const aliasInverse = new Map<string, string[]>();
  for (const [variant, canonical] of Object.entries(TOKEN_ALIASES)) {
    const list = aliasInverse.get(canonical) ?? [];
    list.push(variant);
    aliasInverse.set(canonical, list);
  }
  for (const value of values) {
    for (const token of tokens(value)) {
      if (token.length < 3) continue;
      out.add(token);
      for (const variant of aliasInverse.get(token) ?? []) out.add(variant);
    }
    // Raw accented forms, lowercased, same noise/length rules.
    for (const raw of value.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
      if (raw.length >= 3 && !NOISE.has(normalizeText(raw))) out.add(raw);
    }
  }
  return [...out];
}
