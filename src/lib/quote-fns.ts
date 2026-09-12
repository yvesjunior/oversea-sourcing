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
import { QUOTE_DECLINE_REASONS, type QuoteDeclineReason } from "@/database/schema";
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
  /** When OSI actually sent the request to the supplier — null until staff
   *  mark it sent, and on every row created before 2026-09-12. */
  sentAt: string | null;
  /** Why the offer is out of the running. Only set when status is `declined`. */
  declineReason: QuoteDeclineReason | null;
  /** Hours between the ask and the answer; null until they answer. The
   *  supplier-responsiveness signal, computed rather than stored. */
  responseHours: number | null;
  /** Which clock `responseHours` was measured from. `requested` means the row
   *  predates `sent_at` or was never marked sent, so the figure still includes
   *  OSI's own lag — do not present it as a supplier metric without saying so. */
  responseFrom: "sent" | "requested";
};

/** What the buyer may do with a quote, resolved server-side so the UI never
 *  has to re-derive a rule. */
export type QuoteListResult = {
  quotes: QuoteView[];
  /** True for OSI staff with the `deals` permission — they see the entry form. */
  canRecord: boolean;
  /** False for a viewer seat: read-only members cannot solicit or accept. */
  canAct: boolean;
  /**
   * The buyer's need, per request id — what staff are answering.
   *
   * Carried with the list rather than fetched per row: a staff member keying
   * in a supplier's reply needs the specification in front of them (it is what
   * the supplier was asked about), and making them open the dossier in another
   * tab to read it is how the wrong figure gets typed.
   */
  needs: Record<string, RequestNeed>;
};

export type RequestNeed = {
  title: string;
  description: string;
  criteria: { label: string; value: string; unit: string | null }[];
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
    sentAt: quote.sentAt ? quote.sentAt.toISOString() : null,
    declineReason: quote.declineReason ?? null,
    respondedAt: responded ? responded.toISOString() : null,
    // Measured from when OSI actually SENT the request, not from when the
    // buyer asked for it — the gap between those two is ours, not the
    // supplier's, and this figure is meant to be a supplier signal (ADR Part I
    // §6). Falls back to requestedAt for rows that predate sent_at, and
    // `responseFrom` tells the reader which clock was used rather than
    // presenting both as the same measurement.
    responseHours: responded
      ? Math.round(
          ((responded.getTime() - (quote.sentAt ?? quote.requestedAt).getTime()) / 3_600_000) * 10,
        ) / 10
      : null,
    responseFrom: quote.sentAt ? ("sent" as const) : ("requested" as const),
  };
}

/**
 * What one solicitation did. Counted rather than boolean, because "nothing
 * happened" has three different causes and the buyer is owed the right one:
 * every supplier picked was already being asked, or has already answered, or
 * the request is already settled on someone else.
 */
export type RequestQuotesResult =
  | { ok: true; created: number; reopened: number; skipped: number }
  | { ok: false; reason: "forbidden" | "not_found" | "already_decided" };

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
  .handler(async ({ data }): Promise<RequestQuotesResult> => {
    const [
      { requireWorkspaceRole },
      { auth },
      { getRequest },
      { db },
      { and, eq, inArray },
      schema,
    ] = await Promise.all([
      import("@/server/workspace-guard"),
      import("@/server/auth"),
      import("@tanstack/react-start/server"),
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);
    const caller = await requireWorkspaceRole(getRequest().headers, "buyer");
    if (!caller) return { ok: false, reason: "forbidden" };
    // No internal-workspace check here on purpose: this fn only ever finds a
    // request already scoped to the caller's workspace, and a request cannot
    // exist in OSI's own workspace (createRequestFn refuses it). The choke
    // point is where customer data ENTERS. A guard here would also be the
    // wrong shape the day staff act on a buyer's behalf.

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

    // What is already on this request for the suppliers being asked. One
    // row per (request, supplier) — quote_request_supplier_uq — so a second
    // ask REOPENS the existing row rather than adding another.
    const existing = await db.query.quote.findMany({
      where: and(
        eq(schema.quote.requestId, data.requestId),
        inArray(
          schema.quote.supplierId,
          matches.map((m) => m.supplierId),
        ),
      ),
    });
    const bySupplier = new Map(existing.map((q) => [q.supplierId, q]));
    // A request with an accepted offer is settled. Soliciting more suppliers
    // against it would invite a second acceptance the partial unique index
    // forbids anyway, so refuse the whole call rather than half of it.
    if (existing.some((q) => q.status === "accepted")) {
      return { ok: false, reason: "already_decided" };
    }

    const fresh = matches.filter((m) => !bySupplier.has(m.supplierId));
    const reopenable = existing.filter((q) => q.status === "declined" || q.status === "expired");
    // requested / received: already in flight or already answered. Skipped,
    // and COUNTED, because "nothing happened" needs a reason on screen.
    const skipped = existing.length - reopenable.length;

    const inserted =
      fresh.length === 0
        ? []
        : await db
            .insert(schema.quote)
            .values(
              fresh.map((match) => ({
                id: crypto.randomUUID(),
                requestId: data.requestId,
                organizationId: caller.workspaceId,
                supplierId: match.supplierId,
                // Snapshot: the row stays readable if the supplier is gone.
                supplierName: nameById.get(match.supplierId) ?? "—",
                status: "requested" as const,
                requestedBy: caller.userId,
              })),
            )
            .returning({ id: schema.quote.id });

    const { transitionQuote } = await import("@/server/deals");
    for (const quote of reopenable) {
      // A fresh solicitation, so the clocks start again: the previous
      // decline reason, send stamp and answer belong to the round that
      // ended, and leaving them would make the new response time nonsense.
      await transitionQuote(quote.id, quote.status, "requested", {
        declineReason: null,
        sentAt: null,
        sentBy: null,
        respondedAt: null,
        requestedAt: new Date(),
        requestedBy: caller.userId,
      });
    }
    const touched = inserted.length + reopenable.length;

    if (touched > 0) {
      const { recordEvent } = await import("@/server/requests");
      // There is no dossier yet, so this belongs on the request's own
      // timeline where the buyer is already looking.
      await recordEvent(data.requestId, caller.workspaceId, "quotes.requested", {
        count: touched,
      });

      // Alert the staff who can act (owner decision 2026-09-07: email, and
      // an in-app row for the mobile app that will ring on it later).
      //
      // ONE notification for the whole action, not one per supplier: the
      // buyer ticking five companies is a single decision, and per-supplier
      // would mail every staff member five times for one click.
      //
      // Guarded by `inserted.length > 0`, so a re-ask that changed nothing
      // (onConflictDoNothing above) alerts nobody. Keyed on `deals` — the
      // same permission recordQuoteFn requires to key the answer back in,
      // so everyone told about this can actually do something about it.
      // The name is a SNAPSHOT — it is what keeps the row readable after the
      // account is deleted, which is the whole point of the tombstone columns.
      const actor = await auth.api.getSession({ headers: getRequest().headers });
      const { logAudit } = await import("@/server/audit");
      await logAudit({
        actorId: caller.userId,
        actorName: actor?.user.name ?? null,
        organizationId: caller.workspaceId,
        action: "quotes.requested",
        target: `#${data.requestId}`,
        detail: { count: touched, created: inserted.length, reopened: reopenable.length },
      });

      const { notifyStaff } = await import("@/server/notify");
      await notifyStaff("deals", {
        type: "quotes_requested",
        params: { count: touched, id: data.requestId },
        link: `/soumissions`,
        exceptUserId: caller.userId,
        email: {
          subjectFr: `${touched} fournisseur(s) à solliciter — demande #${data.requestId}`,
          subjectEn: `${touched} supplier(s) to solicit — request #${data.requestId}`,
          bodyFr: `Un client a choisi ${touched} fournisseur(s) à solliciter pour la demande #${data.requestId}.\nRien n'est parti : la demande de soumission doit être envoyée à la main.\nOuvrez les soumissions dans OSI pour voir qui contacter.`,
          bodyEn: `A customer picked ${touched} supplier(s) to solicit for request #${data.requestId}.\nNothing has been sent: the quote request goes out by hand.\nOpen the quotes list in OSI to see who to contact.`,
        },
      });
    }
    return { ok: true, created: inserted.length, reopened: reopenable.length, skipped };
  });

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
    if (!caller) return { quotes: [], canRecord: false, canAct: false, needs: {} };

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

    const quotes = rows.map((r) => toView(r.quote, r.title, r.workspaceName));
    return {
      quotes,
      needs: await loadNeeds(quotes.map((q) => q.requestId)),
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
  async (): Promise<QuoteListResult> => {
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
      return { quotes: [], canRecord: false, canAct: false, needs: {} };
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

    const quotes = rows.map((r) => toView(r.quote, r.title, r.workspaceName));
    return {
      quotes,
      canRecord: true,
      canAct: true,
      needs: await loadNeeds(quotes.map((q) => q.requestId)),
    };
  },
);

/** The specification behind each request in a list, keyed by request id. */
async function loadNeeds(requestIds: readonly string[]): Promise<Record<string, RequestNeed>> {
  const ids = [...new Set(requestIds)];
  if (ids.length === 0) return {};
  const [{ db }, { asc, inArray }, schema] = await Promise.all([
    import("@/database"),
    import("drizzle-orm"),
    import("@/database/schema"),
  ]);
  const [requests, criteria] = await Promise.all([
    db.query.request.findMany({ where: inArray(schema.request.id, ids) }),
    db.query.requestCriterion.findMany({
      where: inArray(schema.requestCriterion.requestId, ids),
      orderBy: [asc(schema.requestCriterion.position)],
    }),
  ]);
  const needs: Record<string, RequestNeed> = {};
  for (const request of requests) {
    needs[request.id] = {
      title: request.title,
      description: request.descriptionRaw,
      criteria: criteria
        .filter((c) => c.requestId === request.id)
        .map((c) => ({ label: c.label, value: c.value, unit: c.unit })),
    };
  }
  return needs;
}

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

    const { offerEntryMode } = await import("@/lib/deal-status");
    const mode = offerEntryMode(quote.status);
    if (mode === null) return { ok: false, reason: "frozen" };

    // A CORRECTION IS NOT A TRANSITION. Driving the state machine for both is
    // what made a mistyped price permanent: the second call was
    // `received → received`, which is illegal, so it threw and the UI hid the
    // form to match. Same fields, same guard, no state change.
    if (mode === "correct") {
      const changed: Record<string, unknown> = {};
      const before = {
        amountCents: quote.amountCents,
        currency: quote.currency,
        quantity: quote.quantity,
        moq: quote.moq,
        leadTimeDays: quote.leadTimeDays,
        incoterm: quote.incoterm,
        paymentTerms: quote.paymentTerms,
        notes: quote.notes,
      };
      const after = {
        amountCents: data.amountCents ?? null,
        currency: data.currency ?? null,
        quantity: data.quantity ?? null,
        moq: data.moq ?? null,
        leadTimeDays: data.leadTimeDays ?? null,
        incoterm: data.incoterm ?? null,
        paymentTerms: data.paymentTerms ?? null,
        notes: data.notes ?? null,
      };
      for (const [key, value] of Object.entries(after)) {
        const was = before[key as keyof typeof before];
        if (was !== value) changed[key] = { from: was, to: value };
      }
      if (Object.keys(changed).length === 0) return { ok: true };

      await db
        .update(schema.quote)
        .set({
          ...after,
          // respondedAt is NOT touched: a correction is not a new answer, and
          // rewriting it would move the response time this table exists to
          // measure. recordedBy IS updated — whoever fixed it owns the figure.
          recordedBy: session.user.id,
          updatedAt: new Date(),
        })
        .where(eq(schema.quote.id, quote.id));

      const { logAudit, actorOf } = await import("@/server/audit");
      await logAudit({
        ...actorOf(session),
        organizationId: quote.organizationId,
        action: "quote.corrected",
        target: quote.supplierName,
        // The before/after of a money field is the whole point of the row.
        detail: { request: quote.requestId, changed },
      });
      return { ok: true };
    }

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

    const { logAudit, actorOf } = await import("@/server/audit");
    await logAudit({
      ...actorOf(session),
      // The buyer's workspace, not OSI's: the row is about their dossier, and
      // their own journal filters on it.
      organizationId: quote.organizationId,
      action: "quote.received",
      target: quote.supplierName,
      detail: {
        request: quote.requestId,
        ...(data.amountCents != null ? { amountCents: data.amountCents } : {}),
        ...(data.currency ? { currency: data.currency } : {}),
        ...(data.leadTimeDays != null ? { leadTimeDays: data.leadTimeDays } : {}),
      },
    });

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

/**
 * Staff mark the request as actually sent to the supplier (parcours step 06).
 *
 * The send itself is an email, by hand, outside the platform — suppliers have
 * no account (ADR Part II §2), so the platform can only record that it
 * happened. That record is what makes `responseHours` a supplier metric
 * instead of a mixed one: before this existed the clock started when the BUYER
 * asked, so an afternoon's delay at OSI's end was published as a slow supplier.
 *
 * Idempotent: marking an already-sent request again is a no-op rather than a
 * refusal, because a second click must never rewrite the clock the response
 * time is measured from.
 */
export const markQuoteSentFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ quoteIds: z.array(z.string().min(1)).min(1).max(20) }))
  .handler(async ({ data }): Promise<{ ok: boolean; marked: number }> => {
    const [
      { effectiveHasPermission },
      { auth },
      { getRequest },
      { db },
      { and, eq, inArray, isNull },
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
    const session = await auth.api.getSession({ headers });
    // Same gate as recording an answer: this is OSI's side of the exchange.
    if (!session || !(await effectiveHasPermission(session, "deals"))) {
      return { ok: false, marked: 0 };
    }

    const now = new Date();
    const marked = await db
      .update(schema.quote)
      .set({ sentAt: now, sentBy: session.user.id, updatedAt: now })
      .where(
        and(
          inArray(schema.quote.id, data.quoteIds),
          // Only ones still awaiting an answer, and only once.
          eq(schema.quote.status, "requested"),
          isNull(schema.quote.sentAt),
        ),
      )
      .returning({ id: schema.quote.id });
    if (marked.length === 0) return { ok: true, marked: 0 };

    const first = await db.query.quote.findFirst({
      where: eq(schema.quote.id, marked[0]!.id),
    });
    const { logAudit, actorOf } = await import("@/server/audit");
    await logAudit({
      ...actorOf(session),
      organizationId: first?.organizationId ?? null,
      action: "quote.sent",
      target: first ? `#${first.requestId}` : null,
      detail: { count: marked.length },
    });
    return { ok: true, marked: marked.length };
  });

/**
 * The offer is out of the running, and WHY is part of the record.
 *
 * `reason` is required and typed: a free-text note cannot be aggregated, and
 * this field exists precisely so the supplier graph can tell "never answered"
 * (a supplier signal) from "we picked someone else" (not one). The note stays
 * for the human detail that no enum can carry.
 */
export const declineQuoteFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      quoteId: z.string().min(1),
      reason: z.enum(QUOTE_DECLINE_REASONS),
      note: z.string().trim().max(300).optional(),
    }),
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
        declineReason: data.reason,
        notes: data.note ?? quote.notes,
      });
    } catch {
      return { ok: false };
    }

    const { logAudit, actorOf } = await import("@/server/audit");
    await logAudit({
      ...actorOf(session),
      organizationId: quote.organizationId,
      action: "quote.declined",
      target: quote.supplierName,
      detail: { request: quote.requestId, reason: data.reason },
    });
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
          //
          // `lost` is the whole point of the reason column: these suppliers
          // did nothing wrong — several will have answered quickly with good
          // terms — and recording them the same way as a supplier who never
          // replied would teach the graph the opposite of the truth.
          await tx
            .update(schema.quote)
            .set({ status: "declined", declineReason: "lost", updatedAt: new Date() })
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
