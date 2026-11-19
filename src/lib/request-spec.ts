// The cahier des charges (Phase V · V19) — the pure half.
//
// A request's SPECIFICATION as a record: what a supplier is asked to quote
// against, frozen as a version (`request_spec`). Before this, "the spec" was
// whatever the criteria rows said at the instant someone looked — the RFQ
// read them live when it was sent, and nothing recorded what an offer had
// actually answered.
//
// Built from the request and its criteria. Two things it deliberately is not
// built from:
//
//   • THE BUYER. The builder is never handed a workspace, a person or an
//     address, so it cannot print one (decision D6: a supplier learns who the
//     customer is when a dossier opens). The one place identity can still
//     reach a supplier is the buyer's own free text — which is why staff read
//     the RFQ preview before sending, exactly as before.
//   • THE CLARIFICATION'S TRANSCRIPT (V18). The assistant's sentences are not
//     the buyer's requirement; what the buyer ACCEPTED from them already is a
//     criterion, and reaches the spec that way.
//
// Attachments enter as a count: their file names are the buyer's (and often
// name the buyer), and what they say reaches the spec as criteria the
// research stage extracts from them.

import type { CriteriaCategory } from "@/database/schema";

export type SpecCriterion = {
  /** The `request_criterion` row this was copied from. Kept so the RFQ can
   *  find that row's English form at send time, and so a KPI profile's
   *  per-criterion weights can be read against the spec they belong to. */
  id: string;
  category: CriteriaCategory;
  label: string;
  value: string;
  unit: string | null;
  required: boolean;
  /** The product row. */
  primary: boolean;
};

export type SpecLocale = "fr" | "en";

export type SpecContent = {
  locale: SpecLocale;
  title: string;
  /** Taxonomy node id, when the request was filed under one. */
  categoryId: string | null;
  /** The buyer's own words. */
  description: string;
  criteria: SpecCriterion[];
  /** How many files the buyer attached. */
  attachments: number;
  /** The same content as a text, in the request's language — what a person
   *  reads on the dossier and what the RFQ's need block says. */
  text: string;
};

export type SpecInput = {
  locale: string;
  title: string;
  categoryId: string | null;
  description: string;
  criteria: ReadonlyArray<{
    id: string;
    category: CriteriaCategory;
    label: string;
    value: string;
    unit: string | null;
    required: boolean;
    isPrimary: boolean;
    position: number;
  }>;
  attachments: number;
};

const COPY = {
  fr: {
    need: "Besoin",
    specifications: "Spécifications",
    required: "obligatoire",
    description: "Description du client (telle qu'il l'a rédigée)",
    attachments: (count: number) =>
      count === 1 ? "1 pièce jointe au dossier" : `${count} pièces jointes au dossier`,
  },
  en: {
    need: "What is needed",
    specifications: "Specifications",
    required: "required",
    description: "The client's own description (as written)",
    attachments: (count: number) =>
      count === 1 ? "1 file attached to the request" : `${count} files attached to the request`,
  },
} as const;

/** "Pression : 16 bar" — one criterion as a line. */
export function specCriterionLine(
  criterion: Pick<SpecCriterion, "label" | "value" | "unit">,
): string {
  return `${criterion.label}: ${criterion.value}${criterion.unit ? ` ${criterion.unit}` : ""}`;
}

function renderText(content: Omit<SpecContent, "text">): string {
  const copy = COPY[content.locale];
  const blocks: string[] = [`${copy.need.toUpperCase()}\n${content.title}`];
  if (content.criteria.length > 0) {
    blocks.push(
      [
        copy.specifications.toUpperCase(),
        ...content.criteria.map(
          (c) => `  - ${specCriterionLine(c)}${c.required ? ` (${copy.required})` : ""}`,
        ),
      ].join("\n"),
    );
  }
  if (content.description) {
    blocks.push(`${copy.description.toUpperCase()}\n${content.description}`);
  }
  if (content.attachments > 0) blocks.push(copy.attachments(content.attachments));
  return blocks.join("\n\n");
}

/** Build the specification from what the request holds right now. */
export function buildSpecContent(input: SpecInput): SpecContent {
  const base = {
    locale: (input.locale === "en" ? "en" : "fr") as SpecLocale,
    title: input.title.trim(),
    categoryId: input.categoryId,
    description: input.description.trim(),
    criteria: [...input.criteria]
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
      .map((c) => ({
        id: c.id,
        category: c.category,
        label: c.label.trim(),
        value: c.value.trim(),
        unit: c.unit?.trim() || null,
        required: c.required,
        primary: c.isPrimary,
      })),
    attachments: input.attachments,
  };
  return { ...base, text: renderText(base) };
}

/**
 * A stable text form of a specification: two contents with the same
 * fingerprint ask a supplier for the same thing, and do not make a new
 * version.
 *
 * The criterion ids are NOT in it. Deleting a criterion and typing it back
 * gives a new row and the same requirement — a supplier would be asked
 * nothing different, so the spec has not changed.
 */
export function specFingerprint(content: SpecContent): string {
  return JSON.stringify([
    content.locale,
    content.title,
    content.categoryId,
    content.description,
    content.criteria.map((c) => [c.category, c.label, c.value, c.unit, c.required, c.primary]),
    content.attachments,
  ]);
}
