// Writing a request's criteria — the ONE place that does it after intake.
//
// Two callers, and they must not be able to drift: the edit form
// (`src/lib/criteria-fns.ts`) and an accepted proposal from the assistant
// (`src/server/clarification.ts`, V18). "Accepted proposals become
// `request_criterion` rows exactly as a manual edit would" is only true while
// both go through here — same columns, same `source`, same event.
//
// Guards (workspace, seat, `criteriaEditable`) stay with the callers: they
// differ in how they refuse, not in what they write.

import { and, eq, max } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import type { CriteriaCategory } from "@/database/schema";
import { recordEvent, type Executor } from "@/server/requests";
import { refreshSpecIfAny, type SpecActor } from "@/server/spec";

export type CriterionFields = {
  category: CriteriaCategory;
  label: string;
  value: string;
  unit: string | null;
  required: boolean;
};

/** Append a criterion. `source: "user"` — whoever typed it, a person decided
 *  it belongs to the request. */
export async function insertCriterion(
  requestId: string,
  fields: CriterionFields,
  executor: Executor = db,
): Promise<void> {
  const [row] = await executor
    .select({ max: max(schema.requestCriterion.position) })
    .from(schema.requestCriterion)
    .where(eq(schema.requestCriterion.requestId, requestId));
  await executor.insert(schema.requestCriterion).values({
    id: crypto.randomUUID(),
    requestId,
    category: fields.category,
    label: fields.label,
    value: fields.value,
    unit: fields.unit,
    required: fields.required,
    source: "user",
    position: (row?.max ?? -1) + 1,
  });
}

/** Rewrite a criterion. False when it is not one of this request's — gone, or
 *  never was. */
export async function updateCriterion(
  requestId: string,
  id: string,
  fields: CriterionFields,
  executor: Executor = db,
): Promise<boolean> {
  const updated = await executor
    .update(schema.requestCriterion)
    .set({
      category: fields.category,
      label: fields.label,
      value: fields.value,
      unit: fields.unit,
      required: fields.required,
      source: "user",
    })
    .where(
      and(eq(schema.requestCriterion.id, id), eq(schema.requestCriterion.requestId, requestId)),
    )
    .returning({ id: schema.requestCriterion.id });
  return updated.length > 0;
}

/** Remove a criterion. False when there was nothing to remove. */
export async function deleteCriterion(
  requestId: string,
  id: string,
  executor: Executor = db,
): Promise<boolean> {
  const deleted = await executor
    .delete(schema.requestCriterion)
    .where(
      and(eq(schema.requestCriterion.id, id), eq(schema.requestCriterion.requestId, requestId)),
    )
    .returning({ id: schema.requestCriterion.id });
  return deleted.length > 0;
}

/** What every criteria write leaves behind: the timeline line, a request
 *  that reads as touched — and, once the request has a specification, its
 *  next version (V19). "Editing criteria after a spec exists creates version
 *  2" is enforced here because every edit, by hand or accepted from the
 *  assistant, ends here. */
export async function criteriaEdited(
  requestId: string,
  organizationId: string,
  executor: Executor = db,
  /** Whose edit it was — recorded on the spec version it makes. */
  actor: SpecActor = null,
): Promise<void> {
  await recordEvent(requestId, organizationId, "criteria.updated", undefined, executor);
  await executor
    .update(schema.request)
    .set({ updatedAt: new Date() })
    .where(eq(schema.request.id, requestId));
  await refreshSpecIfAny(requestId, actor, executor);
}
