// Sourcing configuration — one knob, everything else derived from it.
//
// The only number that is a product decision is how many suppliers the buyer
// gets back. Search count and candidate caps are not preferences: they are
// whatever it takes to answer with that many GOOD suppliers, so they are
// computed here rather than exposed as separate settings that can drift out of
// step with each other (three searches while asking for a Top 20 would return
// "the only 20 we found", which is a ranking of nothing).

/** Read a bounded integer from the environment, falling back loudly rather than
 *  letting a typo silently change what a request returns or costs. */
function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < min || value > max) {
    console.warn(`${name}="${raw}" is not an integer in [${min}, ${max}] — using ${fallback}`);
    return fallback;
  }
  return value;
}

/**
 * How many suppliers the buyer sees on a dossier. THE configurable number.
 */
export const SUPPLIERS_RETURNED = envInt("SUPPLIERS_RETURNED", 5, 1, 20);

/**
 * Companies one research pass may propose.
 *
 * Deliberately a multiple of what we display: ranking only means something when
 * the matcher had more to choose from than it kept. Floored at 12 so a small
 * Top 3 still gets a real shortlist behind it, capped at 30 to bound the
 * extraction response.
 */
export const RESEARCH_CANDIDATE_CAP = Math.min(30, Math.max(12, SUPPLIERS_RETURNED * 3));

/**
 * Web searches per research pass — the main cost driver ($10 / 1000).
 *
 * Measured: 3 searches surface 6-12 companies, enough to rank a Top 5 with
 * room to spare. More results asked for means more ground to cover, so this
 * scales, but stays bounded — beyond ~6 a pass can outrun the worker's
 * two-minute stranded window and collect a duplicate pipeline job.
 */
export const RESEARCH_SEARCHES = Math.min(6, Math.max(3, Math.ceil(SUPPLIERS_RETURNED / 2)));

// ── Store-first thresholds (validated design 2026-08-22; exact numbers are ──
// the A8 draft — env-overridable so tuning them is not a deploy).
// A request answers from the sources' own stores when the store's answer is
// GOOD ENOUGH; live collection (global_web's AI search) is the fallback for
// too few candidates, match too low, or confidence too low.

/** Store entries older than this don't count toward coverage (still matchable). */
export const STORE_FRESH_DAYS = envInt("STORE_FRESH_DAYS", 90, 1, 365);

/** A store candidate must score at least this (0-98 scale) to count. */
export const STORE_MIN_SCORE = envInt("STORE_MIN_SCORE", 40, 1, 98);

/** …and carry at least this confidence (0-100) to count. */
export const STORE_MIN_CONFIDENCE = envInt("STORE_MIN_CONFIDENCE", 30, 0, 100);

/** Qualifying candidates needed to skip live collection — headroom over the
 *  Top-N so ranking still means choosing, not keeping whatever exists. */
export const STORE_MIN_CANDIDATES = envInt(
  "STORE_MIN_CANDIDATES",
  Math.min(40, SUPPLIERS_RETURNED * 2),
  1,
  60,
);

// ── Big-store prefilter (C2b, 2026-08-24) ───────────────────────────────────
// A static store can hold hundreds of thousands of name-only records
// (registry-ca: ~393k). Loading and token-scanning them in memory per request
// would sink the pipeline, so sources ABOVE this row count are prefiltered in
// SQL: only records whose NAME matches a request-criteria token are loaded
// (they are the only ones the matcher could score anyway). Sources at or
// below the threshold keep the full in-memory behavior.

/** Row count above which a source's store is SQL-prefiltered by name tokens. */
export const BIG_STORE_THRESHOLD = envInt("BIG_STORE_THRESHOLD", 5_000, 100, 1_000_000);

/** Hard cap on rows the prefilter may return per request — a degenerate token
 *  ("inox" in a directory of steelworks) must not reload the whole store. */
export const BIG_STORE_FILTER_LIMIT = envInt("BIG_STORE_FILTER_LIMIT", 20_000, 100, 100_000);
