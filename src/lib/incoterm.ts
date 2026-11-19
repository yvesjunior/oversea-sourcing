// Incoterms 2020 — what the platform reads from one. Pure and client-safe.
//
// Moved out of kpi2.ts and pack-explain.ts (V24) so that the ranking, the
// cost block and the landed-cost calculation read a term the same way.

/** The eleven terms, ordered by how much the SELLER takes on. */
export const INCOTERMS = [
  "EXW",
  "FCA",
  "FAS",
  "FOB",
  "CFR",
  "CIF",
  "CPT",
  "CIP",
  "DAP",
  "DPU",
  "DDP",
] as const;
export type Incoterm = (typeof INCOTERMS)[number];

/** "fob Shanghai" → "FOB"; null when no known term is in the text. */
export function readIncoterm(raw: string | null | undefined): Incoterm | null {
  if (!raw) return null;
  const tokens = raw.toUpperCase().match(/[A-Z]{3}/g) ?? [];
  const known = INCOTERMS as readonly string[];
  return (tokens.find((token) => known.includes(token)) as Incoterm | undefined) ?? null;
}

/** The cost lines a term can put INSIDE the seller's price. */
export type CoveredLine = "main_carriage" | "insurance" | "import_duties" | "inspection";

/**
 * What the seller's price covers. Only what the rules say — main carriage to
 * the named place, insurance where the seller must insure, import duties
 * under DDP alone. Inspection is never the seller's by an incoterm.
 */
const COVERS: Record<CoveredLine, readonly Incoterm[]> = {
  main_carriage: ["CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"],
  insurance: ["CIF", "CIP"],
  import_duties: ["DDP"],
  inspection: [],
};

/** Is this line inside the supplier's price, by the incoterm they quoted on? */
export function termCovers(incoterm: string | null | undefined, line: CoveredLine): boolean {
  const term = readIncoterm(incoterm);
  return term !== null && COVERS[line].includes(term);
}
