// Per-request AI chat (E3) — inline gateway call (no job: chat is interactive).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const postChatMessageFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ requestId: z.string(), content: z.string().trim().min(1).max(2000) }))
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    // Chat is gated platform-wide (AI_CHAT) — the hero prompt is the only
    // AI-facing input unless explicitly enabled.
    const { chatEnabled } = await import("@/server/ai/flags");
    if (!chatEnabled()) return { ok: false };

    const [{ auth }, { getRequest }, { db }, { asc, eq }, schema] = await Promise.all([
      import("@/server/auth"),
      import("@tanstack/react-start/server"),
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);
    const session = await auth.api.getSession({ headers: getRequest().headers });
    const workspaceId = session?.session.activeOrganizationId;
    if (!session || !workspaceId) return { ok: false };

    // B1: chat mutates the dossier (messages + criteria) — working seat only.
    const { requireMember } = await import("@/server/workspace-guard");
    if (!(await requireMember(session.user.id, workspaceId, "buyer"))) return { ok: false };

    const request = await db.query.request.findFirst({
      where: eq(schema.request.id, data.requestId),
    });
    if (!request || request.organizationId !== workspaceId) return { ok: false };

    await db.insert(schema.requestMessage).values({
      id: crypto.randomUUID(),
      requestId: request.id,
      role: "user",
      content: data.content,
    });

    const [criteria, history] = await Promise.all([
      db.query.requestCriterion.findMany({
        where: eq(schema.requestCriterion.requestId, request.id),
        orderBy: [asc(schema.requestCriterion.position)],
      }),
      db.query.requestMessage.findMany({
        where: eq(schema.requestMessage.requestId, request.id),
        orderBy: [asc(schema.requestMessage.createdAt)],
      }),
    ]);

    let reply: string;
    let operationsApplied = 0;
    try {
      const { chatAboutRequest } = await import("@/server/ai/chat");
      const result = await chatAboutRequest({
        title: request.title,
        descriptionRaw: request.descriptionRaw,
        locale: request.locale,
        criteria: criteria.map((criterion) => ({
          id: criterion.id,
          category: criterion.category,
          label: criterion.label,
          value: criterion.value,
          unit: criterion.unit,
          required: criterion.required,
        })),
        // History already contains the just-inserted user message — pass the
        // prior turns and send the new content as the final user message.
        history: history.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
        userMessage: data.content,
      });
      reply = result.reply;

      const { and, max } = await import("drizzle-orm");
      for (const op of result.operations) {
        if (op.op === "add" && op.label && op.value) {
          const [row] = await db
            .select({ max: max(schema.requestCriterion.position) })
            .from(schema.requestCriterion)
            .where(eq(schema.requestCriterion.requestId, request.id));
          await db.insert(schema.requestCriterion).values({
            id: crypto.randomUUID(),
            requestId: request.id,
            category: op.category ?? "other",
            label: op.label,
            value: op.value,
            unit: op.unit,
            required: op.required ?? false,
            source: "ai",
            position: (row?.max ?? -1) + 1,
          });
          operationsApplied++;
        } else if (op.op === "update" && op.id) {
          await db
            .update(schema.requestCriterion)
            .set({
              ...(op.category ? { category: op.category } : {}),
              ...(op.label ? { label: op.label } : {}),
              ...(op.value ? { value: op.value } : {}),
              ...(op.unit !== null ? { unit: op.unit } : {}),
              ...(op.required !== null ? { required: op.required } : {}),
            })
            .where(
              and(
                eq(schema.requestCriterion.id, op.id),
                eq(schema.requestCriterion.requestId, request.id),
              ),
            );
          operationsApplied++;
        } else if (op.op === "remove" && op.id) {
          await db
            .delete(schema.requestCriterion)
            .where(
              and(
                eq(schema.requestCriterion.id, op.id),
                eq(schema.requestCriterion.requestId, request.id),
              ),
            );
          operationsApplied++;
        }
      }
    } catch (error) {
      console.error(`chat: assistant call failed for request ${request.id}`, error);
      reply =
        request.locale === "en"
          ? "The assistant is unavailable right now. Please try again shortly."
          : "L'assistant est indisponible pour le moment. Veuillez réessayer dans un instant.";
    }

    await db.insert(schema.requestMessage).values({
      id: crypto.randomUUID(),
      requestId: request.id,
      role: "assistant",
      content: reply,
    });

    const { recordEvent } = await import("@/server/requests");
    if (operationsApplied > 0) {
      await recordEvent(request.id, workspaceId, "chat.refined", {
        count: operationsApplied,
      });
    }
    await db
      .update(schema.request)
      .set({ updatedAt: new Date() })
      .where(eq(schema.request.id, request.id));

    return { ok: true };
  });
