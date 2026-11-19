// The clarification before launch (Phase V · V18) — server functions.
//
// Inline model call (no job): the buyer is looking at the page and waiting
// for the answer. Gated platform-wide by AI_CHAT; with it off every function
// here refuses and the pages show none of this.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { CLARIFY_MESSAGE_MAX } from "@/lib/clarification";

export type ClarifyResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "disabled"
        | "forbidden"
        /** Launched or cancelled in the meantime. */
        | "not_draft"
        /** The request's allowance of clarifications is used up. */
        | "limit"
        /** The model could not be reached; nothing was counted. */
        | "unavailable"
        /** The model answered with nothing usable. */
        | "no_answer";
    };

/** The session, the working seat and the request — or why not. Shared by the
 *  two writes below. */
async function ownRequest(requestId: string) {
  const { chatEnabled } = await import("@/server/ai/flags");
  if (!chatEnabled()) return { refusal: "disabled" as const };

  const [{ auth }, { getRequest }, { db }, { eq }, schema] = await Promise.all([
    import("@/server/auth"),
    import("@tanstack/react-start/server"),
    import("@/database"),
    import("drizzle-orm"),
    import("@/database/schema"),
  ]);
  const session = await auth.api.getSession({ headers: getRequest().headers });
  const workspaceId = session?.session.activeOrganizationId;
  if (!session || !workspaceId) return { refusal: "forbidden" as const };

  // B1: this spends the workspace's money and changes its dossier — working
  // seat only, re-read per call.
  const { requireMember } = await import("@/server/workspace-guard");
  if (!(await requireMember(session.user.id, workspaceId, "buyer"))) {
    return { refusal: "forbidden" as const };
  }

  const request = await db.query.request.findFirst({ where: eq(schema.request.id, requestId) });
  if (!request || request.organizationId !== workspaceId) return { refusal: "forbidden" as const };
  return { request, session };
}

/**
 * Ask the assistant to read the draft, or answer what it asked.
 *
 * `content` absent = "read my draft". This is the only way a clarification
 * starts: there is no timer and no job behind it.
 */
export const askClarificationFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      requestId: z.string(),
      content: z.string().trim().min(1).max(CLARIFY_MESSAGE_MAX).optional(),
    }),
  )
  .handler(async ({ data }): Promise<ClarifyResult> => {
    const ctx = await ownRequest(data.requestId);
    if ("refusal" in ctx) return { ok: false, reason: ctx.refusal };
    const { runClarification } = await import("@/server/clarification");
    return runClarification({ request: ctx.request, userMessage: data.content ?? null });
  });

export type ResolveProposalResult =
  { ok: true } | { ok: false; reason: "disabled" | "forbidden" | "not_pending" | "stale" };

/** Accept or decline one proposal. An accept writes the criterion exactly as
 *  the edit form would (`src/server/criteria.ts`). */
export const resolveProposalFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ requestId: z.string(), proposalId: z.string(), accept: z.boolean() }))
  .handler(async ({ data }): Promise<ResolveProposalResult> => {
    const ctx = await ownRequest(data.requestId);
    if ("refusal" in ctx) return { ok: false, reason: ctx.refusal };
    const { resolveProposal } = await import("@/server/clarification");
    const outcome = await resolveProposal({
      requestId: ctx.request.id,
      proposalId: data.proposalId,
      accept: data.accept,
      actor: { id: ctx.session.user.id, name: ctx.session.user.name },
    });
    return outcome.ok ? { ok: true } : outcome;
  });
