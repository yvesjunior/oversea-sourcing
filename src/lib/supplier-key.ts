// Entity resolution key (E4) — pure, client- and server-safe.
//
// The research agent finds the same company under many spellings ("AQUATEK",
// "Aquatek GmbH", "AQUATEK  Gmbh."). Collapsing them to one key lets the
// unique index on supplier.dedup_key reject the duplicate at insert time
// instead of trusting a read-then-write check that races.

/** Legal forms that carry no identity — dropped before comparing names. */
const LEGAL_SUFFIXES = [
  "gmbh",
  "mbh",
  "ag",
  "kg",
  "ohg",
  "sarl",
  "sas",
  "sa",
  "sasu",
  "eurl",
  "srl",
  "spa",
  "snc",
  "bv",
  "nv",
  "ab",
  "as",
  "oy",
  "aps",
  "ltd",
  "limited",
  "llc",
  "lp",
  "llp",
  "inc",
  "incorporated",
  "corp",
  "corporation",
  "co",
  "company",
  "plc",
  "pte",
  "pty",
  "kft",
  "sp",
  "zoo",
  "doo",
  "dd",
  "group",
  "holding",
  "holdings",
  "international",
  "industries",
  "industrie",
  "industrial",
];

/** Fold accents and case, strip punctuation → comparable token list.
 *  Unicode-aware (2026-08-25, registry-jp): kanji/kana/hangul names must
 *  produce keys too — the old `[^a-z0-9]` class reduced them to nothing and
 *  every Japanese company would have been silently dropped. Latin names are
 *  unaffected: accents are already folded to ASCII before this step. */
function tokenize(name: string): string[] {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/** The name half of the dedup key, alone — accents/case/punctuation folded,
 *  legal suffixes dropped. The sanctions screening join column (ADR-001 §4):
 *  "Banco Nacional de Cuba S.A." and OFAC's "BANCO NACIONAL DE CUBA" both
 *  slug to "banconacionaldecuba". Null when nothing identifying remains. */
export function nameSlug(name: string): string | null {
  const tokens = tokenize(name);
  // Single letters are punctuation debris ("S.A." → "s","a"), never identity —
  // dropping them makes "… S.A." and the bare name screen as equal.
  const meaningful = tokens.filter((token) => token.length > 1 && !LEGAL_SUFFIXES.includes(token));
  const slug = (meaningful.length > 0 ? meaningful : tokens).join("");
  return slug.length < 2 ? null : slug;
}

/**
 * `dedup_key` for a supplier: normalized name + country.
 *
 * Country is part of the key on purpose — two unrelated companies may share a
 * short name across borders, and merging them would be worse than keeping a
 * duplicate. Returns null when there is not enough to identify a company.
 */
export function supplierDedupKey(name: string, countryCode: string): string | null {
  const country = countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) return null;

  const tokens = tokenize(name);
  // Drop legal forms, but never everything — "Industries SA" keeps "industries"
  // rather than collapsing to an empty key that would collide with the next one.
  const meaningful = tokens.filter((token) => !LEGAL_SUFFIXES.includes(token));
  const slug = (meaningful.length > 0 ? meaningful : tokens).join("");
  if (slug.length < 2) return null;

  return `${slug}|${country}`;
}
