// Soumissions (Phase P2) — parcours steps 05-08.
//
// The BUYER picks which of their Top-N to approach (owner 2026-08-29: "the
// buyer picks"); OSI sends the requests; staff record what comes back. The
// supplier never touches the platform, so every offer reaches us through a
// human and is keyed in by staff — that is the whole shape of this file.
//
// Why the response data lives here at all: `requested_at → responded_at`, MOQ,
// lead time and price are the outcomes ADR-001 called the moat. They arrive as
// a by-product of the tab the brief asked for.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { QuoteStatus } from "@/database/schema";

export type QuoteView = {
  id: string;
  requestId: string;
  requestTitle: string;
  /** The customer account this quote belongs to. Staff lists carry every
   *  account at once, so the row has to name its own — and the filter keys on
   *  the id, never the name. */
  organizationId: string;
  organizationName: string;
  supplierId: string | null;
  supplierName: string;
  status: QuoteStatus;
  amountCents: number | null;
  currency: string | null;
  quantity: string | null;
  moq: string | null;
  leadTimeDays: number | null;
  incoterm: string | null;
  paymentTerms: string | null;
  notes: string | null;
  /** ISO strings — the client formats. */
  requestedAt: string;
  respondedAt: string | null;
  /** Hours between the ask and the answer; null until they answer. The
   *  supplier-responsiveness signal, computed rather than stored. */
  responseHours: number | null;
};

/** What the buyer may do with a quote, resolved server-side so the UI never
 *  has to re-derive a rule. */
export type QuoteListResult = {
  quotes: QuoteView[];
  /** True for OSI staff with the `deals` permission — they see the entry form. */
  canRecord: boolean;
  /** False for a viewer seat: read-only members cannot solicit or accept. */
  canAct: boolean;
};

function toView(
  quote: typeof import("@/database/schema").quote.$inferSelect,
  requestTitle: string,
  organizationName: string,
): QuoteView {
  const responded = quote.respondedAt;
  return {
    id: quote.id,
    requestId: quote.requestId,
    requestTitle,
    organizationId: quote.organizationId,
    organizationName,
    supplierId: quote.supplierId,
    supplierName: quote.supplierName,
    status: quote.status,
    amountCents: quote.amountCents,
    currency: quote.currency,
    quantity: quote.quantity,
    moq: quote.moq,
    leadTimeDays: quote.leadTimeDays,
    incoterm: quote.incoterm,
    paymentTerms: quote.paymentTerms,
    notes: quote.notes,
    requestedAt: quote.requestedAt.toISOString(),
    respondedAt: responded ? responded.toISOString() : null,
    responseHours: responded
      ? Math.round(((responded.getTime() - quote.requestedAt.getTime()) / 3_600_000) * 10) / 10
      : null,
  };
}

/**
 * The buyer asks OSI to approach the suppliers they picked from their Top-N.
 *
 * Nothing is sent without this: no automatic solicitation, ever. Supplier ids
 * are validated against the request's OWN matches, so a crafted payload
 * cannot solicit a company that was never presented.
 */
export const requestQuotesFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      requestId: z.string().min(1),
      supplierIds: z.array(z.string().min(1)).min(1).max(20),
    }),
  )
  .handler(
    async ({
      data,
    }): Promise<
      { ok: true; created: number } | { ok: false; reason: "forbidden" | "not_found" }
    > => {
      const [{ requireWorkspaceRole }, { getRequest }, { db }, { and, eq, inArray }, schema] =
        await Promise.all([
          import("@/server/workspace-guard"),
          import("@tanstack/react-start/server"),
          import("@/database"),
          import("drizzle-orm"),
          import("@/database/schema"),
        ]);
      const caller = await requireWorkspaceRole(getRequest().headers, "buyer");
      if (!caller) return { ok: false, reason: "forbidden" };

      const request = await db.query.request.findFirst({
        where: and(
          eq(schema.request.id, data.requestId),
          eq(schema.request.organizationId, caller.workspaceId),
        ),
      });
      if (!request) return { ok: false, reason: "not_found" };

      // Only suppliers this request actually presented. Anything else is
      // either a mistake or someone probing the endpoint.
      const matches = await db.query.match.findMany({
        where: and(
          eq(schema.match.requestId, data.requestId),
          inArray(schema.match.supplierId, data.supplierIds),
        ),
      });
      if (matches.length === 0) return { ok: false, reason: "not_found" };

      const suppliers = await db.query.supplier.findMany({
        where: inArray(
          schema.supplier.id,
          matches.map((m) => m.supplierId),
        ),
      });
      const nameById = new Map(suppliers.map((s) => [s.id, s.name]));

      const rows = matches.map((match) => ({
        id: crypto.randomUUID(),
        requestId: data.requestId,
        organizationId: caller.workspaceId,
        supplierId: match.supplierId,
        // Snapshot: the row must stay readable if the supplier is ever gone.
        supplierName: nameById.get(match.supplierId) ?? "—",
        status: "requested" as const,
        requestedBy: caller.userId,
      }));
      // Re-asking the same supplier updates rather than duplicating
      // (quote_request_supplier_uq); an offer already received is left alone.
      const inserted = await db
        .insert(schema.quote)
        .values(rows)
        .onConflictDoNothing({
          target: [schema.quote.requestId, schema.quote.supplierId],
        })
        .returning({ id: schema.quote.id });

      if (inserted.length > 0) {
        const { recordEvent } = await import("@/server/requests");
        // There is no dossier yet, so this belongs on the request's own
        // timeline where the buyer is already looking.
        await recordEvent(data.requestId, caller.workspaceId, "quotes.requested", {
          count: inserted.length,
        });
      }
      return { ok: true, created: inserted.length };
    },
  );

/** Every quote in the caller's workspace, newest request first. Staff see
 *  their own workspace here too — the global ops view is a separate surface. */
export const getMyQuotesFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<QuoteListResult> => {
    const [
      { requireWorkspaceRole, effectiveHasPermission },
      { auth },
      { getRequest },
      { db },
      { desc, eq },
      schema,
    ] = await Promise.all([
      import("@/server/workspace-guard"),
      import("@/server/auth"),
      import("@tanstack/react-start/server"),
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);
    const headers = getRequest().headers;
    const caller = await requireWorkspaceRole(headers, "viewer");
    if (!caller) return { quotes: [], canRecord: false, canAct: false };

    const session = await auth.api.getSession({ headers });
    const canRecord = session ? await effectiveHasPermission(session, "deals") : false;

    const rows = await db
      .select({
        quote: schema.quote,
        title: schema.request.title,
        workspaceName: schema.organization.name,
      })
      .from(schema.quote)
      .innerJoin(schema.request, eq(schema.request.id, schema.quote.requestId))
      .innerJoin(schema.organization, eq(schema.organization.id, schema.quote.organizationId))
      .where(eq(schema.quote.organizationId, caller.workspaceId))
      .orderBy(desc(schema.quote.requestedAt));

    return {
      quotes: rows.map((r) => toView(r.quote, r.title, r.workspaceName)),
      canRecord,
      // A viewer seat is read-only: they may look, not solicit or accept.
      canAct: caller.role !== "viewer",
    };
  },
);

/**
 * EVERY workspace's quotes — the OSI ops view.
 *
 * Necessary, not a nicety: quotes belong to the BUYER's workspace, while
 * staff stand in the internal one (effectivePlatformRole). Without this a
 * staff member sees an empty page and cannot record the offer they were
 * emailed — which is the whole job. Same shape as `getAllRequestsFn`.
 */
export const getAllQuotesFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ quotes: QuoteView[]; canRecord: boolean }> => {
    const [{ effectiveHasPermission }, { auth }, { getRequest }, { db }, { desc, eq }, schema] =
      await Promise.all([
        import("@/server/workspace-guard"),
        import("@/server/auth"),
        import("@tanstack/react-start/server"),
        import("@/database"),
        import("drizzle-orm"),
        import("@/database/schema"),
      ]);
    const headers = getRequest().headers;
    const session = await auth.api.getSession({ headers });
    // Staff powers exist only inside the internal workspace — that check is
    // what effectiveHasPermission does, and it is why raw platformRole is
    // never used here.
    if (!session || !(await effectiveHasPermission(session, "deals"))) {
      return { quotes: [], canRecord: false };
    }

    const rows = await db
      .select({
        quote: schema.quote,
        title: schema.request.title,
        workspaceName: schema.organization.name,
      })
      .from(schema.quote)
      .innerJoin(schema.request, eq(schema.request.id, schema.quote.requestId))
      .innerJoin(schema.organization, eq(schema.organization.id, schema.quote.organizationId))
      .orderBy(desc(schema.quote.requestedAt));

    return {
      quotes: rows.map((r) => toView(r.quote, r.title, r.workspaceName)),
      canRecord: true,
    };
  },
);

/** The quotes attached to one request — the dossier's Soumissions panel. */
export const getQuotesForRequestFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ requestId: z.string().min(1) }))
  .handler(async ({ data }): Promise<QuoteView[]> => {
    const [{ requireWorkspaceRole }, { getRequest }, { db }, { and, asc, eq }, schema] =
      await Promise.all([
        import("@/server/workspace-guard"),
        import("@tanstack/react-start/server"),
        import("@/database"),
        import("drizzle-orm"),
        import("@/database/schema"),
      ]);
    const caller = await requireWorkspaceRole(getRequest().headers, "viewer");
    if (!caller) return [];

    const rows = await db
      .select({
        quote: schema.quote,
        title: schema.request.title,
        workspaceName: schema.organization.name,
      })
      .from(schema.quote)
      .innerJoin(schema.request, eq(schema.request.id, schema.quote.requestId))
      .innerJoin(schema.organization, eq(schema.organization.id, schema.quote.organizationId))
      .where(
        and(
          eq(schema.quote.requestId, data.requestId),
          eq(schema.quote.organizationId, caller.workspaceId),
        ),
      )
      .orderBy(asc(schema.quote.requestedAt));

    return rows.map((r) => toView(r.quote, r.title, r.workspaceName));
  });

/**
 * Staff key in an offer that arrived by email. Moves the quote to `received`
 * and stamps `responded_at` — which is what turns "we asked five suppliers"
 * into a response-time signal we own and nobody can scrape.
 */
export const recordQuoteFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      quoteId: z.string().min(1),
      amountCents: z.number().int().min(0).max(1_000_000_000_00).nullable().optional(),
      currency: z.string().trim().length(3).nullable().optional(),
      quantity: z.string().trim().max(80).nullable().optional(),
      moq: z.string().trim().max(80).nullable().optional(),
      leadTimeDays: z.number().int().min(0).max(3650).nullable().optional(),
      incoterm: z.string().trim().max(20).nullable().optional(),
      paymentTerms: z.string().trim().max(200).nullable().optional(),
      notes: z.string().trim().max(2000).nullable().optional(),
    }),
  )
  .handler(async ({ data }): Promise<{ ok: boolean; reason?: string }> => {
    const [{ effectiveHasPermission }, { auth }, { getRequest }, { db }, { eq }, schema] =
      await Promise.all([
        import("@/server/workspace-guard"),
        import("@/server/auth"),
        import("@tanstack/react-start/server"),
        import("@/database"),
        import("drizzle-orm"),
        import("@/database/schema"),
      ]);
    const headers = getRequest().headers;
    const session = await auth.api.getSession({ headers });
    // Staff only: the supplier has no account, so an offer can only ever be
    // entered by the person who received it.
    if (!session || !(await effectiveHasPermission(session, "deals"))) {
      return { ok: false, reason: "forbidden" };
    }

    const quote = await db.query.quote.findFirst({ where: eq(schema.quote.id, data.quoteId) });
    if (!quote) return { ok: false, reason: "not_found" };

    const { transitionQuote } = await import("@/server/deals");
    try {
      await transitionQuote(quote.id, quote.status, "received", {
        amountCents: data.amountCents ?? null,
        currency: data.currency ?? null,
        quantity: data.quantity ?? null,
        moq: data.moq ?? null,
        leadTimeDays: data.leadTimeDays ?? null,
        incoterm: data.incoterm ?? null,
        paymentTerms: data.paymentTerms ?? null,
        notes: data.notes ?? null,
        // Only stamp the answer time once — a correction is not a new answer.
        respondedAt: quote.respondedAt ?? new Date(),
        recordedBy: session.user.id,
      });
    } catch (error) {
      console.error(`recordQuote: ${quote.id}`, error);
      return { ok: false, reason: "illegal_transition" };
    }

    const request = await db.query.request.findFirst({
      where: eq(schema.request.id, quote.requestId),
    });
    if (request?.createdBy) {
      const { notifyUser } = await import("@/server/notify");
      await notifyUser({
        userId: request.createdBy,
        organizationId: quote.organizationId,
        type: "quote_received",
        params: { supplier: quote.supplierName, id: quote.requestId },
        link: `/soumissions`,
        email: {
          subjectFr: `Une soumission est arrivée — ${quote.supplierName}`,
          subjectEn: `A quote has arrived — ${quote.supplierName}`,
          bodyFr: `${quote.supplierName} a répondu à votre demande #${quote.requestId}. Comparez les offres reçues dans OSI.`,
          bodyEn: `${quote.supplierName} answered your request #${quote.requestId}. Compare the offers you have received in OSI.`,
        },
      });
    }
    return { ok: true };
  });

/** The supplier said no, or did not answer in time. Staff-only, same reason. */
export const declineQuoteFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({ quoteId: z.string().min(1), reason: z.string().trim().max(300).optional() }),
  )
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const [{ effectiveHasPermission }, { auth }, { getRequest }, { db }, { eq }, schema] =
      await Promise.all([
        import("@/server/workspace-guard"),
        import("@/server/auth"),
        import("@tanstack/react-start/server"),
        import("@/database"),
        import("drizzle-orm"),
        import("@/database/schema"),
      ]);
    const headers = getRequest().headers;
    const session = await auth.api.getSession({ headers });
    if (!session || !(await effectiveHasPermission(session, "deals"))) return { ok: false };

    const quote = await db.query.quote.findFirst({ where: eq(schema.quote.id, data.quoteId) });
    if (!quote) return { ok: false };

    const { transitionQuote } = await import("@/server/deals");
    try {
      await transitionQuote(quote.id, quote.status, "declined", {
        notes: data.reason ?? quote.notes,
      });
    } catch {
      return { ok: false };
    }
    return { ok: true };
  });

/**
 * The buyer accepts ONE offer — parcours step 09, and the single event that
 * opens a dossier (brief §4 steps 1-2).
 *
 * NO SPLITTING (owner 2026-08-29, "pas de répartitions"): one accepted offer,
 * one dossier. A buyer who wants two suppliers makes two requests. The
 * database enforces it through the partial unique index
 * `quote_one_accepted_per_request_uq`, because an application-side check
 * would let two simultaneous acceptances both through — so the violation is
 * CAUGHT here and returned as a typed refusal rather than surfacing as a 500.
 */
export const acceptQuoteFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ quoteId: z.string().min(1) }))
  .handler(
    async ({
      data,
    }): Promise<
      | { ok: true; dealId: string }
      | { ok: false; reason: "forbidden" | "not_found" | "not_received" | "already_accepted" }
    > => {
      const [{ requireWorkspaceRole }, { getRequest }, { db }, { and, eq, ne }, schema] =
        await Promise.all([
          import("@/server/workspace-guard"),
          import("@tanstack/react-start/server"),
          import("@/database"),
          import("drizzle-orm"),
          import("@/database/schema"),
        ]);
      // A viewer seat may look at offers, never commit the company to one.
      const caller = await requireWorkspaceRole(getRequest().headers, "buyer");
      if (!caller) return { ok: false, reason: "forbidden" };

      const quote = await db.query.quote.findFirst({
        where: and(
          eq(schema.quote.id, data.quoteId),
          eq(schema.quote.organizationId, caller.workspaceId),
        ),
      });
      if (!quote) return { ok: false, reason: "not_found" };
      // You cannot accept an offer that never arrived.
      if (quote.status !== "received") return { ok: false, reason: "not_received" };

      const request = await db.query.request.findFirst({
        where: eq(schema.request.id, quote.requestId),
      });
      const dealId = crypto.randomUUID();

      try {
        await db.transaction(async (tx) => {
          await tx
            .update(schema.quote)
            .set({ status: "accepted", updatedAt: new Date() })
            .where(eq(schema.quote.id, quote.id));

          // Everything else on this request is out of the running. Not
          // cosmetic: `accepted` is terminal, so leaving siblings open would
          // suggest a choice that can no longer be made.
          await tx
            .update(schema.quote)
            .set({ status: "declined", updatedAt: new Date() })
            .where(
              and(
                eq(schema.quote.requestId, quote.requestId),
                ne(schema.quote.id, quote.id),
                eq(schema.quote.status, "received"),
              ),
            );

          await tx.insert(schema.deal).values({
            id: dealId,
            organizationId: caller.workspaceId,
            requestId: quote.requestId,
            quoteId: quote.id,
            supplierId: quote.supplierId,
            // Snapshots — the dossier must stay readable without them.
            supplierName: quote.supplierName,
            title: request?.title ?? quote.supplierName,
            status: "open",
            amountCents: quote.amountCents,
            currency: quote.currency,
            incoterm: quote.incoterm,
            createdBy: caller.userId,
            createdByName: caller.userName,
          });

          // The match enum has carried `selected`/`rejected` since day one and
          // nothing ever set them. This is what they were for.
          if (quote.supplierId) {
            await tx
              .update(schema.match)
              .set({ status: "selected" })
              .where(
                and(
                  eq(schema.match.requestId, quote.requestId),
                  eq(schema.match.supplierId, quote.supplierId),
                ),
              );
            await tx
              .update(schema.match)
              .set({ status: "rejected" })
              .where(
                and(
                  eq(schema.match.requestId, quote.requestId),
                  ne(schema.match.supplierId, quote.supplierId),
                ),
              );
          }
        });
      } catch (error) {
        // 23505 = the partial unique index: someone accepted first.
        const code = (error as { code?: string }).code;
        if (code === "23505") return { ok: false, reason: "already_accepted" };
        throw error;
      }

      const [{ recordDealEvent }, { recordEvent }, { logAudit }] = await Promise.all([
        import("@/server/deals"),
        import("@/server/requests"),
        import("@/server/audit"),
      ]);
      await recordDealEvent(dealId, caller.workspaceId, "deal.opened", {
        supplier: quote.supplierName,
        requestId: quote.requestId,
      });
      await recordEvent(quote.requestId, caller.workspaceId, "quote.accepted", {
        supplier: quote.supplierName,
      });
      await logAudit({
        actorId: caller.userId,
        actorName: caller.userName,
        organizationId: caller.workspaceId,
        action: "deal.opened",
        target: quote.supplierName,
        detail: { dealId, requestId: quote.requestId, quoteId: quote.id },
      });
      return { ok: true, dealId };
    },
  );
