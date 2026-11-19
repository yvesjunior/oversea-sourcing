// Criteria review/edit server functions (E3). Tenancy is enforced by joining
// through the parent request — writes are own-workspace only, always.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { CRITERIA_CATEGORIES } from "@/database/schema";
import { criteriaEditable } from "@/lib/request-status";

const criterionFields = {
  category: z.enum(CRITERIA_CATEGORIES),
  label: z.string().trim().min(1).max(200),
  value: z.string().trim().min(1).max(200),
  unit: z.string().trim().max(30).nullable(),
  required: z.boolean(),
};

/** Loads the request and checks it belongs to the caller's workspace.
 *  Returns null when the caller may not write. */
async function requireOwnRequest(requestId: string) {
  const [{ auth }, { getRequest }, { db }, { eq }, schema] = await Promise.all([
    import("@/server/auth"),
    import("@tanstack/react-start/server"),
    import("@/database"),
    import("drizzle-orm"),
    import("@/database/schema"),
  ]);
  const session = await auth.api.getSession({ headers: getRequest().headers });
  const workspaceId = session?.session.activeOrganizationId;
  if (!session || !workspaceId) return null;
  // B1: editing criteria is working-seat work — viewers are read-only.
  const { requireMember } = await import("@/server/workspace-guard");
  if (!(await requireMember(session.user.id, workspaceId, "buyer"))) return null;
  const row = await db.query.request.findFirst({
    where: eq(schema.request.id, requestId),
  });
  if (!row || row.organizationId !== workspaceId) return null;
  // FROZEN once the search has answered (V06). The page stopped offering the
  // edit long ago; nothing here did, so a direct call could change a
  // specification suppliers were already quoting against. `criteriaEditable`
  // is an allow list — a state added later is frozen until someone decides.
  if (!criteriaEditable(row.status)) return null;
  return { request: row, workspaceId };
}

export const addCriterionFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ requestId: z.string(), ...criterionFields }))
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const ctx = await requireOwnRequest(data.requestId);
    if (!ctx) return { ok: false };
    // The writes live in src/server/criteria.ts, shared with an accepted
    // proposal from the assistant (V18) — one definition of "a manual edit".
    const { insertCriterion, criteriaEdited } = await import("@/server/criteria");
    const { requestId, ...fields } = data;
    await insertCriterion(requestId, fields);
    await criteriaEdited(requestId, ctx.workspaceId);
    return { ok: true };
  });

export const updateCriterionFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ requestId: z.string(), id: z.string(), ...criterionFields }))
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const ctx = await requireOwnRequest(data.requestId);
    if (!ctx) return { ok: false };
    const { updateCriterion, criteriaEdited } = await import("@/server/criteria");
    const { requestId, id, ...fields } = data;
    await updateCriterion(requestId, id, fields);
    await criteriaEdited(requestId, ctx.workspaceId);
    return { ok: true };
  });

export const deleteCriterionFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ requestId: z.string(), id: z.string() }))
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const ctx = await requireOwnRequest(data.requestId);
    if (!ctx) return { ok: false };
    const { deleteCriterion, criteriaEdited } = await import("@/server/criteria");
    await deleteCriterion(data.requestId, data.id);
    await criteriaEdited(data.requestId, ctx.workspaceId);
    return { ok: true };
  });
