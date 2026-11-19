// The clarification before launch (Phase V · V18) — the pure half.
//
// The buyer asks the assistant to read a draft: it restates the need, asks
// what is missing, and proposes changes to the criteria. It never writes one.
// This file holds what can be decided without a database or a model:
//
//   • which basics a draft lacks        — `absentBasics`
//   • what the model's output is worth  — `normalizeProposals`
//   • how many times it may be asked    — `clarifyTurnsLeft`
//
// The model call is `src/server/ai/chat.ts`; the rows are
// `src/server/clarification.ts`.

import { CRITERIA_CATEGORIES, type CriteriaCategory, type ProposalOp } from "@/database/schema";

/**
 * Clarifications a request may run, counted on turns that reached the model.
 *
 * Each one is a paid call, and nothing else bounds them: the plan's quota
 * counts REQUESTS (at creation, V20's gotcha), so without this a single draft
 * could be asked a thousand times. Six covers "ask, answer, answer again" with
 * room to spare; a need that is still unclear after six exchanges is not one a
 * seventh call fixes.
 */
export const CLARIFY_MAX_TURNS = 6;

export function clarifyTurnsLeft(turnsUsed: number): number {
  return Math.max(0, CLARIFY_MAX_TURNS - turnsUsed);
}

/** What a buyer may type in one answer — the same ceiling the chat had. */
export const CLARIFY_MESSAGE_MAX = 2000;

/** The limits a manual edit enforces (`criteria-fns.ts`) — a proposal that
 *  would not pass them could not be accepted "exactly as a manual edit". */
export const CRITERION_LIMITS = { label: 200, value: 200, unit: 30 } as const;

/** Proposals kept from one turn. A model that returns thirty has stopped
 *  clarifying and started inventing. */
export const PROPOSALS_PER_TURN = 8;

/**
 * The categories no supplier can quote without, and that a draft may simply
 * not carry. The model is told which are absent so that "what is missing"
 * starts from the criteria rows rather than from its reading of the prose —
 * the rows are what the search and the RFQ are built from.
 *
 * Deliberately short. Material, pressure or a certification matter for some
 * products and mean nothing for others; whether THIS product needs one is a
 * judgement, and that part is left to the model.
 */
export const BASIC_CATEGORIES: readonly CriteriaCategory[] = ["quantity", "lead_time"];

export function absentBasics(
  criteria: ReadonlyArray<{ category: string; value: string }>,
): CriteriaCategory[] {
  return BASIC_CATEGORIES.filter(
    (basic) => !criteria.some((c) => c.category === basic && c.value.trim() !== ""),
  );
}

export type ExistingCriterion = {
  id: string;
  category: CriteriaCategory;
  label: string;
  value: string;
  unit: string | null;
  required: boolean;
};

/** One operation as the model returns it — every field may be missing. */
export type RawOperation = {
  op: string;
  id?: string | null;
  category?: string | null;
  label?: string | null;
  value?: string | null;
  unit?: string | null;
  required?: boolean | null;
};

/** A proposal worth showing: the FULL criterion an accept would leave. */
export type NormalizedProposal = {
  op: ProposalOp;
  criterionId: string | null;
  category: CriteriaCategory;
  label: string;
  value: string;
  unit: string | null;
  required: boolean;
  /** For an update: what the value was, as "value unit". Null when the value
   *  does not change. */
  previous: string | null;
  /** For an update: what `required` was. Null when it does not change. */
  previousRequired: boolean | null;
};

/** A proposal from an earlier turn, as far as a new turn needs to know it. */
export type EarlierProposal = Pick<
  NormalizedProposal,
  "op" | "criterionId" | "label" | "value" | "unit" | "required"
> & { status: "pending" | "dismissed" };

function clean(text: string | null | undefined, max: number): string {
  return (text ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function isCategory(value: string | null | undefined): value is CriteriaCategory {
  return (CRITERIA_CATEGORIES as readonly string[]).includes(value ?? "");
}

function sameText(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** "500 pièces" — a criterion's value as a buyer reads it. */
export function valueWithUnit(value: string, unit: string | null): string {
  return unit ? `${value} ${unit}` : value;
}

/**
 * Turn the model's operations into proposals, dropping what cannot stand.
 *
 * The model's output is a suggestion about someone's purchase, and it is
 * wrong in predictable ways. Each of these was a way the pre-V18 chat could
 * write nonsense into the criteria, since it applied operations as returned:
 *
 *   • an `update` or `remove` naming an id that is not one of this request's
 *     criteria (invented, or copied from the wrong row)   → dropped
 *   • an `add` with no label or no value                   → dropped
 *   • an `add` repeating a criterion that already exists   → dropped
 *   • an `update` that changes nothing                     → dropped
 *   • two operations on the same criterion                 → the first wins
 *   • anything already proposed and waiting, or declined   → dropped
 *   • a category outside the list                          → `other`
 *
 * An update is merged over the existing row, so the result is always the whole
 * criterion: accepting it writes every field, exactly as the edit form does.
 */
export function normalizeProposals(
  operations: readonly RawOperation[],
  criteria: readonly ExistingCriterion[],
  /**
   * What earlier turns proposed and the buyer has not accepted. A second
   * reading of the same draft finds the same things, so without this:
   *
   *   • a proposal still WAITING would be shown again, and accepting both
   *     would write "Quantité : 500" twice;
   *   • a proposal the buyer DECLINED would come back every turn — the model
   *     reads the sentence that prompted it again. Seen live on the first
   *     run: « Type de commande » ignored, and proposed again one turn later.
   *
   * A declined update does not freeze its criterion: the buyer said no to
   * that change, not to every change. Only the identical one is dropped.
   */
  earlier: readonly EarlierProposal[] = [],
): NormalizedProposal[] {
  const byId = new Map(criteria.map((c) => [c.id, c]));
  const touched = new Set<string>(
    earlier.flatMap((e) => (e.status === "pending" && e.criterionId ? [e.criterionId] : [])),
  );
  const earlierAdds = earlier.filter((e) => e.op === "add");
  const declined = earlier.filter((e) => e.status === "dismissed" && e.criterionId);
  const proposals: NormalizedProposal[] = [];

  for (const raw of operations) {
    if (proposals.length >= PROPOSALS_PER_TURN) break;

    if (raw.op === "add") {
      const label = clean(raw.label, CRITERION_LIMITS.label);
      const value = clean(raw.value, CRITERION_LIMITS.value);
      if (!label || !value) continue;
      const category = isCategory(raw.category) ? raw.category : "other";
      const unit = clean(raw.unit, CRITERION_LIMITS.unit) || null;
      const duplicate = (c: { label: string; value: string; unit: string | null }) =>
        sameText(c.label, label) &&
        sameText(valueWithUnit(c.value, c.unit), valueWithUnit(value, unit));
      if (
        criteria.some(duplicate) ||
        earlierAdds.some(duplicate) ||
        proposals.some((p) => p.op === "add" && duplicate(p))
      ) {
        continue;
      }
      proposals.push({
        op: "add",
        criterionId: null,
        category,
        label,
        value,
        unit,
        required: raw.required ?? false,
        previous: null,
        previousRequired: null,
      });
      continue;
    }

    if (raw.op !== "update" && raw.op !== "remove") continue;
    const target = raw.id ? byId.get(raw.id) : undefined;
    if (!target || touched.has(target.id)) continue;

    if (raw.op === "remove") {
      if (declined.some((d) => d.op === "remove" && d.criterionId === target.id)) continue;
      touched.add(target.id);
      proposals.push({
        op: "remove",
        criterionId: target.id,
        category: target.category,
        label: target.label,
        value: target.value,
        unit: target.unit,
        required: target.required,
        previous: null,
        previousRequired: null,
      });
      continue;
    }

    // update — anything the model left out keeps its current value.
    const label = clean(raw.label, CRITERION_LIMITS.label) || target.label;
    const value = clean(raw.value, CRITERION_LIMITS.value) || target.value;
    // `unit: null` from the model means "not mentioned", not "remove the
    // unit": the schema forces every field to be present, so null is what an
    // untouched field looks like. An empty string is how a unit is cleared.
    const unit =
      raw.unit === null || raw.unit === undefined
        ? target.unit
        : clean(raw.unit, CRITERION_LIMITS.unit) || null;
    const category = isCategory(raw.category) ? raw.category : target.category;
    const required = raw.required ?? target.required;
    const unchanged =
      label === target.label &&
      value === target.value &&
      unit === target.unit &&
      category === target.category &&
      required === target.required;
    if (unchanged) continue;
    const sameAsDeclined = declined.some(
      (d) =>
        d.op === "update" &&
        d.criterionId === target.id &&
        sameText(d.label, label) &&
        sameText(valueWithUnit(d.value, d.unit), valueWithUnit(value, unit)) &&
        d.required === required,
    );
    if (sameAsDeclined) continue;
    touched.add(target.id);
    proposals.push({
      op: "update",
      criterionId: target.id,
      category,
      label,
      value,
      unit,
      required,
      previous:
        value !== target.value || unit !== target.unit
          ? valueWithUnit(target.value, target.unit)
          : null,
      previousRequired: required !== target.required ? target.required : null,
    });
  }
  return proposals;
}

/**
 * Earlier additions a new turn replaces: still waiting, and proposing the
 * same criterion (by label) that a new addition now proposes with another
 * value.
 *
 * The buyer answered "8 weeks", then "10 weeks after all" before accepting
 * anything. Without this both stay on the page with an Accept button, and
 * accepting both writes two lead times. The later one is what the buyer last
 * said, so the earlier one is withdrawn — by the system, and the page says so.
 */
export function supersededAdds(
  proposals: readonly NormalizedProposal[],
  earlier: ReadonlyArray<EarlierProposal & { id: string }>,
): string[] {
  const newLabels = proposals.filter((p) => p.op === "add").map((p) => p.label);
  return earlier
    .filter(
      (e) =>
        e.status === "pending" &&
        e.op === "add" &&
        newLabels.some((label) => sameText(label, e.label)),
    )
    .map((e) => e.id);
}

/** Questions as stored: trimmed, non-empty, de-duplicated, at most five. A
 *  clarification that asks twelve things gets none of them answered. */
export const QUESTIONS_PER_TURN = 5;

export function normalizeQuestions(questions: readonly string[]): string[] {
  const kept: string[] = [];
  for (const question of questions) {
    const text = clean(question, 400);
    if (!text || kept.some((k) => sameText(k, text))) continue;
    kept.push(text);
    if (kept.length >= QUESTIONS_PER_TURN) break;
  }
  return kept;
}
