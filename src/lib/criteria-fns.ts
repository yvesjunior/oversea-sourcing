// Criteria review/edit server functions (E3). Tenancy is enforced by joining
// through the parent request — writes are own-workspace only, always.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { CRITERIA_CATEGORIES } from "@/database/schema";

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
  return { db, eq, schema, request: row, workspaceId };
}

async function touchRequest(ctx: NonNullable<Awaited<ReturnType<typeof requireOwnRequest>>>) {
  const { recordEvent } = await import("@/server/requests");
  await recordEvent(ctx.request.id, ctx.workspaceId, "criteria.updated");
  await ctx.db
    .update(ctx.schema.request)
    .set({ updatedAt: new Date() })
    .where(ctx.eq(ctx.schema.request.id, ctx.request.id));
}

export const addCriterionFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ requestId: z.string(), ...criterionFields }))
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const ctx = await requireOwnRequest(data.requestId);
    if (!ctx) return { ok: false };
    const { db, eq, schema } = ctx;
    const { max } = await import("drizzle-orm");
    const [row] = await db
      .select({ max: max(schema.requestCriterion.position) })
      .from(schema.requestCriterion)
      .where(eq(schema.requestCriterion.requestId, data.requestId));
    await db.insert(schema.requestCriterion).values({
      id: crypto.randomUUID(),
      requestId: data.requestId,
      category: data.category,
      label: data.label,
      value: data.value,
      unit: data.unit,
      required: data.required,
      source: "user",
      position: (row?.max ?? -1) + 1,
    });
    await touchRequest(ctx);
    return { ok: true };
  });

export const updateCriterionFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ requestId: z.string(), id: z.string(), ...criterionFields }))
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const ctx = await requireOwnRequest(data.requestId);
    if (!ctx) return { ok: false };
    const { db, eq, schema } = ctx;
    const { and } = await import("drizzle-orm");
    await db
      .update(schema.requestCriterion)
      .set({
        category: data.category,
        label: data.label,
        value: data.value,
        unit: data.unit,
        required: data.required,
        source: "user",
      })
      .where(
        and(
          eq(schema.requestCriterion.id, data.id),
          eq(schema.requestCriterion.requestId, data.requestId),
        ),
      );
    await touchRequest(ctx);
    return { ok: true };
  });

export const deleteCriterionFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ requestId: z.string(), id: z.string() }))
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const ctx = await requireOwnRequest(data.requestId);
    if (!ctx) return { ok: false };
    const { db, eq, schema } = ctx;
    const { and } = await import("drizzle-orm");
    await db
      .delete(schema.requestCriterion)
      .where(
        and(
          eq(schema.requestCriterion.id, data.id),
          eq(schema.requestCriterion.requestId, data.requestId),
        ),
      );
    await touchRequest(ctx);
    return { ok: true };
  });
