// Intake criteria parsing — deterministic regex heuristics run synchronously
// when a request is created (zero tokens, no AI stage). The info helper on the
// hero prompt guides buyers to structured input; this turns it into rows the
// matcher, the future E4 research agent and the report consume.

import type { CriteriaCategory } from "@/database/schema";

export type ParsedCriterion = {
  category: CriteriaCategory;
  label: string;
  value: string;
  unit: string | null;
  required: boolean;
  /** True on the ONE product row the structured form produces — the primary
   *  matching signal the relevance gate keys on. Never set by the regex
   *  parser: free text has no field that is reliably "the product". */
  isPrimary?: boolean;
};

const MATERIAL_WORDS =
  /\b(acier(?:\s+(?:inoxydable|inox|chromé|galvanisé|carbone))?(?:\s+\d{2,4}\w{0,3})?|inox(?:ydable)?|stainless steel(?:\s+\d{2,4}\w{0,3})?|steel|aluminium|aluminum|titane|titanium|cuivre|copper|laiton|brass|fonte|caoutchouc|rubber|EPDM|PTFE|PET|PVC|polypropyl[eè]ne|plastique|plastic|aramide|kevlar|c[ée]ramique|ceramic)\b/i;

const CERT_PATTERN =
  /\b(ISO\s?\d{3,5}|EN\s?(?:ISO\s?)?\d{3,5}|CE|ATEX|UL|FDA|RoHS|REACH|ASME|API\s?\d+)\b/g;

type Labels = Record<
  "material" | "flow" | "pressure" | "certification" | "quantity" | "lead_time" | "need",
  string
>;

const LABELS: Record<"fr" | "en", Labels> = {
  fr: {
    material: "Matériau",
    flow: "Débit",
    pressure: "Pression",
    certification: "Certifications",
    quantity: "Quantité",
    lead_time: "Délai",
    need: "Besoin",
  },
  en: {
    material: "Material",
    flow: "Flow rate",
    pressure: "Pressure",
    certification: "Certifications",
    quantity: "Quantity",
    lead_time: "Lead time",
    need: "Need",
  },
};

/** What the structured request form (ADR-001 S2) submits — already-typed
 *  fields, no parsing needed. Criteria built from this carry source "user". */
export type StructuredNeed = {
  /** Taxonomy node id (validated against src/lib/taxonomy.ts by the caller). */
  categoryId: string;
  product: string;
  material?: string | undefined;
  certifications?: string[] | undefined;
  quantity?: string | undefined;
  leadTime?: string | undefined;
  /** Free-text nuance — still regex-parsed for pressure/flow etc. */
  details?: string | undefined;
};

/** Criteria straight from the form fields (ADR-001 S2) — the buyer TYPED
 *  these, so nothing is guessed: the product and every filled constraint
 *  become rows, then the free-text details pass through the regex parser for
 *  anything extra (pressure, flow…) without duplicating a category the form
 *  already provided. */
export function structuredCriteria(need: StructuredNeed, locale: string): ParsedCriterion[] {
  const labels = LABELS[locale === "en" ? "en" : "fr"];
  const criteria: ParsedCriterion[] = [];

  // The product is the primary matching signal — required, like a criterion
  // the supplier's text must evidence. `isPrimary` makes that explicit to the
  // matcher: the relevance gate requires THIS row to match, because a
  // supplier evidencing only "ISO 9001" has not shown it makes the product
  // (owner 2026-08-29).
  criteria.push({
    category: "other",
    label: labels.need,
    value: need.product.trim().slice(0, 120),
    unit: null,
    required: true,
    isPrimary: true,
  });
  if (need.material?.trim()) {
    criteria.push({
      category: "material",
      label: labels.material,
      value: need.material.trim(),
      unit: null,
      required: true,
    });
  }
  const certs = (need.certifications ?? []).map((c) => c.trim()).filter(Boolean);
  if (certs.length > 0) {
    criteria.push({
      category: "certification",
      label: labels.certification,
      value: certs.join(", "),
      unit: null,
      required: true,
    });
  }
  if (need.quantity?.trim()) {
    criteria.push({
      category: "quantity",
      label: labels.quantity,
      value: need.quantity.trim(),
      unit: null,
      required: false,
    });
  }
  if (need.leadTime?.trim()) {
    criteria.push({
      category: "lead_time",
      label: labels.lead_time,
      value: need.leadTime.trim(),
      unit: null,
      required: false,
    });
  }

  // Details may still carry parseable specs; keep only categories the form
  // did not already answer, and drop the parser's "need" fallback row (the
  // product row above already plays that role).
  if (need.details?.trim()) {
    const present = new Set(criteria.map((c) => c.category));
    for (const parsed of parseCriteria(need.details, locale)) {
      if (parsed.category === "other") continue;
      if (present.has(parsed.category)) continue;
      criteria.push(parsed);
      present.add(parsed.category);
    }
  }

  return criteria.slice(0, 8);
}

/** Best-effort structured criteria from free text. */
export function parseCriteria(descriptionRaw: string, locale: string): ParsedCriterion[] {
  const labels = LABELS[locale === "en" ? "en" : "fr"];
  const text = descriptionRaw.replace(/\s+/g, " ").trim();
  const criteria: ParsedCriterion[] = [];

  const material = text.match(MATERIAL_WORDS);
  if (material?.[0]) {
    criteria.push({
      category: "material",
      label: labels.material,
      value: material[0].trim(),
      unit: null,
      required: true,
    });
  }

  const pressure = text.match(/(\d+(?:[.,]\d+)?(?:\s*(?:à|a|-|–)\s*\d+(?:[.,]\d+)?)?)\s*bars?\b/i);
  if (pressure?.[1]) {
    criteria.push({
      category: "pressure",
      label: labels.pressure,
      value: pressure[1].trim(),
      unit: "bar",
      required: false,
    });
  }

  const flow = text.match(
    /(\d+(?:[.,]\d+)?(?:\s*(?:à|a|-|–)\s*\d+(?:[.,]\d+)?)?)\s*(m³\/h|m3\/h|l\/min|L\/min)/i,
  );
  if (flow?.[1]) {
    criteria.push({
      category: "flow",
      label: labels.flow,
      value: flow[1].trim(),
      unit: flow[2] === "m3/h" ? "m³/h" : (flow[2] ?? null),
      required: false,
    });
  }

  const certs = [...new Set(text.match(CERT_PATTERN) ?? [])];
  if (certs.length > 0) {
    criteria.push({
      category: "certification",
      label: labels.certification,
      value: certs.join(", "),
      unit: null,
      required: /obligatoire|required|mandatory/i.test(text),
    });
  }

  const quantity = text.match(
    /(\d[\d\s.,]*)\s*(unit[ée]s?|pi[eè]ces?|pcs|machines?|exemplaires?|units?)(\s*(?:par an|\/an|per year|annuelles?))?/i,
  );
  if (quantity?.[1]) {
    criteria.push({
      category: "quantity",
      label: labels.quantity,
      value: `${quantity[1].trim()} ${quantity[2]}${quantity[3] ?? ""}`.trim(),
      unit: null,
      required: false,
    });
  }

  const lead = text.match(
    /(?:livraison|d[ée]lai|delivery|lead time)[^\d]{0,20}(\d+)\s*(jours?|semaines?|mois|days?|weeks?|months?)/i,
  );
  if (lead?.[1]) {
    criteria.push({
      category: "lead_time",
      label: labels.lead_time,
      value: `${lead[1]} ${lead[2]}`,
      unit: null,
      required: false,
    });
  }

  if (criteria.length === 0) {
    // Nothing recognizable — keep the loop moving with the need itself.
    criteria.push({
      category: "other",
      label: labels.need,
      value: text.slice(0, 120),
      unit: null,
      required: false,
    });
  }

  return criteria.slice(0, 8);
}
