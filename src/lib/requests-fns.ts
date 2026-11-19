import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { eventParams, type EventParams } from "@/lib/event-params";
import { canSeeAllRequests } from "@/lib/roles";
import type { CriteriaCategory, RequestStatus } from "@/database/schema";
import { ownerSeesMatches, requestFlow, type RequestFlow } from "@/lib/request-status";
import type { ProposalView } from "@/server/clarification";

export type { ProposalView };

/** Shape the UI consumes; E3 will extend (criteria, pipeline progress…). */
export type RequestSummary = {
  id: string;
  title: string;
  status: RequestStatus;
  compatibilityScore: number | null;
  /** ISO timestamp */
  updatedAt: string;
  /** ISO timestamp — when the need was filed. What a period filter asks
   *  about: "the requests of this week" means the ones that came in, not the
   *  ones a status change happened to touch. */
  createdAt: string;
  /** Set only when viewing across workspaces (employees): whose dossier this
   *  is, and the id the account filter keys on (null in your own workspace —
   *  there is nothing to disambiguate). */
  workspaceName: string | null;
  organizationId: string;
  /** The owning account's name, always populated — `workspaceName` is the
   *  DISPLAY field (nulled in your own workspace so a card does not label
   *  itself); this one is what the account filter groups by. */
  organizationName: string;
  /** Who created it — live name while the account exists, the at-creation
   *  snapshot after deletion (UC-6), null only on pre-snapshot legacy rows. */
  createdByName: string | null;
  /** How many suppliers were asked for an offer on this need (P2). The visual
   *  dossier puts it on the dashboard row, and it is the number that says
   *  whether a dossier is moving. */
  quoteCount: number;
  /** Which flow this request is on — derived from where it has been
   *  (`requestFlow`), never stored. Decides the stages the dossier draws, and
   *  what `report_ready` MEANS: a report on one flow, a released Decision
   *  Pack on the other (V12) — which is why a list needs it too. */
  flow: RequestFlow;
};

/** YOUR sourcing requests, newest first — personal surfaces are own-workspace
 *  only for everyone ("Vos dossiers récents"). Buyers' data for employees
 *  lives on the ops surfaces (getAllRequestsFn → Facilitation). */
export const getMyRequestsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<RequestSummary[]> => {
    const [{ auth }, { getRequest }, { db }, { desc, eq }, schema] = await Promise.all([
      import("@/server/auth"),
      import("@tanstack/react-start/server"),
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);
    const session = await auth.api.getSession({ headers: getRequest().headers });
    const workspaceId = session?.session.activeOrganizationId;
    if (!session || !workspaceId) return [];

    const { sql } = await import("drizzle-orm");
    const rows = await db
      .select({
        id: schema.request.id,
        title: schema.request.title,
        status: schema.request.status,
        compatibilityScore: schema.request.compatibilityScore,
        updatedAt: schema.request.updatedAt,
        createdAt: schema.request.createdAt,
        quoteCount: sql<number>`(select count(*)::int from "quote" where "quote"."request_id" = ${schema.request.id})`,
        // Live name while the account exists; the snapshot survives deletion.
        createdByName: sql<string | null>`coalesce("user"."name", ${schema.request.createdByName})`,
      })
      .from(schema.request)
      .leftJoin(schema.user, eq(schema.user.id, schema.request.createdBy))
      .where(eq(schema.request.organizationId, workspaceId))
      .orderBy(desc(schema.request.updatedAt));

    const { packFlowRequestIds } = await import("@/server/request-flow");
    const packFlow = await packFlowRequestIds(rows.map((row) => row.id));
    return rows.map((row) => ({
      ...row,
      updatedAt: row.updatedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      workspaceName: null,
      organizationId: workspaceId,
      organizationName: "",
      flow: packFlow.has(row.id) ? ("pack" as const) : ("report" as const),
    }));
  },
);

/** ALL buyers' requests — the ops view (Facilitation). Only owner/manager;
 *  everyone else gets an empty list (accountant is forbidden by policy). */
export const getAllRequestsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<RequestSummary[]> => {
    const [{ auth }, { getRequest }, { db }, { desc, eq }, schema] = await Promise.all([
      import("@/server/auth"),
      import("@tanstack/react-start/server"),
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);
    const session = await auth.api.getSession({ headers: getRequest().headers });
    if (!session) return [];
    // Staff powers only from the internal workspace (2026-08-27).
    const { effectiveHasPermission } = await import("@/server/workspace-guard");
    if (!(await effectiveHasPermission(session, "requests.all"))) return [];
    const ownWorkspaceId = session.session.activeOrganizationId;

    const { sql } = await import("drizzle-orm");
    const rows = await db
      .select({
        id: schema.request.id,
        title: schema.request.title,
        status: schema.request.status,
        compatibilityScore: schema.request.compatibilityScore,
        updatedAt: schema.request.updatedAt,
        createdAt: schema.request.createdAt,
        workspaceName: schema.organization.name,
        organizationId: schema.request.organizationId,
        quoteCount: sql<number>`(select count(*)::int from "quote" where "quote"."request_id" = ${schema.request.id})`,
        createdByName: sql<string | null>`coalesce("user"."name", ${schema.request.createdByName})`,
      })
      .from(schema.request)
      .innerJoin(schema.organization, eq(schema.request.organizationId, schema.organization.id))
      .leftJoin(schema.user, eq(schema.user.id, schema.request.createdBy))
      .orderBy(desc(schema.request.updatedAt));

    const { packFlowRequestIds } = await import("@/server/request-flow");
    const packFlow = await packFlowRequestIds(rows.map((row) => row.id));
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      compatibilityScore: row.compatibilityScore,
      updatedAt: row.updatedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      workspaceName: row.organizationId === ownWorkspaceId ? null : row.workspaceName,
      organizationId: row.organizationId,
      organizationName: row.workspaceName,
      quoteCount: row.quoteCount,
      createdByName: row.createdByName,
      flow: packFlow.has(row.id) ? ("pack" as const) : ("report" as const),
    }));
  },
);

export type Criterion = {
  id: string;
  category: CriteriaCategory;
  label: string;
  value: string;
  unit: string | null;
  required: boolean;
  source: "ai" | "user";
  position: number;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** What the assistant asked on this turn (V18); null on a buyer's message
   *  and on a turn that did not reach the model. */
  questions: string[] | null;
  /** The criteria changes this turn proposed, each with the buyer's answer. */
  proposals: ProposalView[];
  /** ISO timestamp */
  createdAt: string;
};

export type RequestEventView = {
  id: string;
  type: string;
  /** Parsed i18n interpolation params (from the JSON `message` column). */
  params: EventParams;
  /** ISO timestamp */
  createdAt: string;
};

export type AttachmentView = {
  id: string;
  fileId: string;
  filename: string;
  mime: string;
  size: number;
};

export type MatchView = {
  id: string;
  rank: number;
  compatibilityScore: number;
  confidenceScore: number;
  riskLevel: "low" | "medium" | "high";
  status: "candidate" | "presented" | "selected" | "rejected";
  supplier: {
    id: string;
    name: string;
    descriptor: string | null;
    countryCode: string;
    /** The company's own site — the buyer's first "who are these people?" click. */
    website: string | null;
    /** Page the research agent read this supplier from (provenance). */
    sourceRef: string | null;
  };
};

export type RequestDetail = RequestSummary & {
  descriptionRaw: string;
  createdAt: string;
  launchedAt: string | null;
  completedAt: string | null;
  criteria: Criterion[];
  messages: ChatMessage[];
  events: RequestEventView[];
  attachments: AttachmentView[];
  /** Why staff refused to send a Decision Pack (V11) — set only on an
   *  `unfulfilled` request, and written FOR the buyer. */
  unfulfilledReason: string | null;
  /**
   * Top-5 supplier candidates, ranked (empty until the search stage ran).
   *
   * ALSO empty for the owning workspace on the PACK flow, at every state: the
   * ranking is then OSI's internal shortlist, and the buyer sees no supplier
   * before the Decision Pack (owner, 2026-11-14). Withheld here, on the
   * server — not hidden by the page. Staff reading across workspaces get it.
   */
  matches: MatchView[];
  /** Size of the supplier pool scored for this request (matches.created event). */
  suppliersAnalyzed: number | null;
  /** Writes allowed — own workspace only (employees read foreign dossiers). */
  canEdit: boolean;
  /** Platform flag AI_CHAT — the assistant UI is hidden when false. */
  aiChatEnabled: boolean;
  /** Clarifications this request may still run (V18). Zero when the flag is
   *  off — nothing can be asked then. */
  clarifyTurnsLeft: number;
  /** The basics no criterion carries yet — quantity, lead time (V20). Plain
   *  code, no model: shown on the validation screen so "what is missing" does
   *  not depend on the assistant being switched on. Empty once launched. */
  missingBasics: CriteriaCategory[];
  /** The buyer's validation of the specification (V20); null when the
   *  request was launched without that step, or has not been validated yet. */
  validated: { at: string; byName: string | null; specVersion: number } | null;
  /** The validation step is on: a held draft is presented for validation
   *  rather than launched. */
  validationOn: boolean;
  /** The last collection pass FAILED, so this dossier's Top-N was built
   *  without one. Derived at read time from research_run — never stored, so
   *  it cannot go stale against the runs it describes. False when research
   *  simply found nobody: that is an answer, and re-running it would just buy
   *  the same answer again. */
  researchFailed: boolean;
  /** Whether THIS caller may act on the above. Computed server-side so the
   *  button is never offered to someone the fn would refuse. */
  canRerunResearch: boolean;
  /** Soumissions are a paid feature (owner 2026-09-14). True when the OWNING
   *  workspace's plan does not include them, so the dossier explains the
   *  refusal before the buyer picks anyone, instead of after. False on a
   *  foreign dossier (staff cannot solicit for a buyer anyway). */
  quotesPlanRequired: boolean;
  /** The owning workspace's plan name, for the refusal text. */
  planName: string;
};

/** Outcome of a create attempt. A refusal is data, not an exception: the UI has
 *  to tell the buyer *why* — expired session vs daily allowance used up. */
export type CreateRequestResult =
  /** `launched` false = the request exists and WAITS: for its buyer's
   *  validation (V20), or as a held draft (V18). Nothing is searched yet, and
   *  the form must not ask for the pipeline to start. */
  | { ok: true; id: string; launched: boolean }
  | { ok: false; reason: "unauthenticated" }
  /** Authenticated but the workspace role forbids it (viewer — read-only). */
  | { ok: false; reason: "forbidden" }
  /** Standing in OSI's own workspace, which holds no customer data by rule
   *  (owner 2026-08-29). Switch to a buyer workspace to act as a buyer. */
  | { ok: false; reason: "internal_workspace" }
  | {
      ok: false;
      reason: "quota_exceeded";
      /** daily = the window resets; lifetime = the trial is over, upgrade. */
      refusal: "daily" | "lifetime";
      limit: number;
      planName: string;
      /** ISO timestamp when the allowance returns (rolling window). */
      resetAt: string | null;
    };

/** Create a request: draft → received, then straight to supplier search.
 *  Two intake shapes (ADR-001 S2): the STRUCTURED form (primary — category +
 *  typed fields become criteria rows directly, source "user") and legacy
 *  free text (criteria regex-parsed at intake, source "ai"). */
export const createRequestFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      description: z.string().trim().min(1).max(5000),
      /** The structured form's fields, verbatim (description above is the
       *  composed rendering of the same answers — the research brief). */
      structured: z
        .object({
          categoryId: z.string().min(1).max(60),
          product: z.string().trim().min(2).max(200),
          material: z.string().trim().max(120).optional(),
          certifications: z.array(z.string().trim().min(1).max(60)).max(12).optional(),
          quantity: z.string().trim().max(80).optional(),
          leadTime: z.string().trim().max(80).optional(),
          details: z.string().trim().max(4000).optional(),
          /** ISO 3166-1 alpha-2, uppercased by the client. Empty/absent =
           *  worldwide (falls back to the workspace preference). */
          countryCodes: z.array(z.string().trim().length(2).toUpperCase()).max(20).optional(),
        })
        .optional(),
      /** The client is about to upload files for this request. Hold the
       *  pipeline until it says go, so the worker doesn't research a request
       *  whose attachments have not landed yet. */
      attachmentsPending: z.boolean().optional(),
      /** Keep the request a DRAFT (V18): the buyer wants the assistant to
       *  read it before anything is searched. Created and counted like any
       *  other, then left alone — no transition, no pipeline, until the buyer
       *  launches it from the dossier. Ignored when AI_CHAT is off: there
       *  would be nothing to do with a draft, and the flow must be today's. */
      hold: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }): Promise<CreateRequestResult> => {
    const [{ auth }, { getRequest }, { db }, { sql }, schema] = await Promise.all([
      import("@/server/auth"),
      import("@tanstack/react-start/server"),
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);
    const session = await auth.api.getSession({ headers: getRequest().headers });
    const workspaceId = session?.session.activeOrganizationId;
    if (!session || !workspaceId) return { ok: false, reason: "unauthenticated" };

    // B1: creating a request needs a working seat — membership re-read per
    // call, so a demotion or removal bites immediately.
    const { requireMember, isInternalWorkspace } = await import("@/server/workspace-guard");
    if (!(await requireMember(session.user.id, workspaceId, "buyer"))) {
      return { ok: false, reason: "forbidden" };
    }
    // OSI's own workspace is for internal action only (owner 2026-08-29):
    // staff have no requests there, so one created from it would be OSI's own
    // customer data sitting in every cross-tenant list. Refused here, not
    // merely unoffered in the UI.
    if (await isInternalWorkspace(workspaceId)) {
      return { ok: false, reason: "internal_workspace" };
    }

    // Quota check + insert under a per-workspace advisory lock: the check is
    // check-then-act, and without the lock two requests arriving together both
    // read the same count, both pass, and both insert (reproduced at 2 rows
    // against a limit of 1 — the "quota race" debt, fixed 2026-08-22). The
    // xact lock serializes creators of ONE workspace and releases on commit;
    // other workspaces are untouched.
    const { checkRequestQuota } = await import("@/server/plan");
    const firstLine = data.description.split("\n").find((line) => line.trim()) ?? "";
    const locale = session.user.locale ?? "fr";

    // Structured intake: the category must be a real taxonomy node — an
    // unknown id is dropped (stored null), never trusted into cache keys.
    const { categoryById } = await import("@/lib/taxonomy");
    const categoryId =
      data.structured && categoryById(data.structured.categoryId)
        ? data.structured.categoryId
        : null;
    const title = data.structured
      ? data.structured.product.slice(0, 80)
      : firstLine.trim().slice(0, 80);

    const outcome = await db.transaction(
      async (tx): Promise<{ id: string } | Extract<CreateRequestResult, { ok: false }>> => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${"request-quota:" + workspaceId}))`,
        );
        // Counted after the lock: any concurrent creator for this workspace has
        // either committed (visible to the count) or is queued behind the lock.
        const quota = await checkRequestQuota(workspaceId, session.user.id);
        if (!quota.allowed) {
          return {
            ok: false,
            reason: "quota_exceeded",
            refusal: quota.refusal ?? "daily",
            limit: quota.refusal === "lifetime" ? quota.limitTotal : quota.limit,
            planName: quota.planName,
            resetAt: quota.resetAt?.toISOString() ?? null,
          };
        }

        const seq = await tx.execute(sql`select nextval('request_id_seq')::text as id`);
        const id = String((seq.rows[0] as { id: string }).id);
        await tx.insert(schema.request).values({
          id,
          organizationId: workspaceId,
          createdBy: session.user.id,
          title: title || `#${id}`,
          descriptionRaw: data.description,
          categoryId,
          countryCodes:
            data.structured?.countryCodes && data.structured.countryCodes.length > 0
              ? data.structured.countryCodes
              : null,
          status: "draft",
          locale,
          // Attribution snapshot (2026-08-26): survives the creator's
          // account deletion (UC-6 re-interpretation).
          createdByName: session.user.name,
        });
        return { id };
      },
    );
    if ("ok" in outcome) return outcome;
    const id = outcome.id;

    // Where the request goes when it leaves the form (V20). With the
    // validation step on — the default — it waits in `spec_review` for its
    // buyer to approve the specification, and `hold` has nothing to add: every
    // request already stops before the search. With the step off it is the
    // older flow: straight to the search, or held as a draft for the
    // assistant when the form asked for that (V18).
    const [{ chatEnabled }, { getSetting }, { entryStatus }] = await Promise.all([
      import("@/server/ai/flags"),
      import("@/server/platform-settings"),
      import("@/lib/request-status"),
    ]);
    const entry = entryStatus(await getSetting("flow.spec_validation"));
    const held = entry === "received" && data.hold === true && chatEnabled();

    const { recordEvent, transitionRequest } = await import("@/server/requests");
    await recordEvent(id, workspaceId, "request.created");
    if (!held) await transitionRequest(id, workspaceId, "draft", entry);

    // Criteria at intake (instant, zero tokens). Structured form (S2): the
    // typed fields become rows directly — nothing is guessed, source "user".
    // Free text: the regex parser does its best, source "ai".
    const { parseCriteria, structuredCriteria } = await import("@/server/parse-criteria");
    const criteria = data.structured
      ? structuredCriteria(data.structured, locale)
      : parseCriteria(data.description, locale);
    if (criteria.length > 0) {
      await db.insert(schema.requestCriterion).values(
        criteria.map((criterion, index) => ({
          id: crypto.randomUUID(),
          requestId: id,
          category: criterion.category,
          label: criterion.label,
          value: criterion.value,
          unit: criterion.unit,
          required: criterion.required,
          source: data.structured ? ("user" as const) : ("ai" as const),
          isPrimary: criterion.isPrimary === true,
          position: index,
        })),
      );
      await recordEvent(id, workspaceId, "criteria.extracted", { count: criteria.length });
    }

    const { logAudit, actorOf } = await import("@/server/audit");
    await logAudit({
      ...actorOf(session),
      organizationId: workspaceId,
      action: "request.created",
      target: `#${id}`,
      detail: {
        title,
        ...(categoryId ? { category: categoryId } : {}),
        ...(held ? { held: true } : {}),
        ...(entry === "spec_review" ? { awaitingValidation: true } : {}),
      },
    });

    // A held draft stops here (V18). Nothing is enqueued and nothing sweeps
    // it: `draft` is not an in-flight state, so the worker never adopts it.
    // "A pending draft never spends money on its own."
    if (held) return { ok: true, id, launched: false };

    // Version 1 of the cahier des charges and of the KPI profile (V19): what
    // the buyer is about to validate, or — with the validation step off —
    // what the request asks for as it leaves their hands.
    try {
      const { ensureSpec } = await import("@/server/spec");
      await ensureSpec(id, { id: session.user.id, name: session.user.name });
    } catch (error) {
      // With the step off this must never fail the creation: the ranking
      // writes the spec if this could not. With the step on, the validation
      // itself writes it (`validateSpecFn` ensures before it compares).
      console.error(`createRequest: could not write the spec of ${id}`, error);
    }

    // Waiting for validation (V20): nothing is enqueued, and `spec_review` is
    // not an in-flight state, so nothing adopts it. The search starts when
    // the buyer validates — `validateSpecFn`.
    if (entry === "spec_review") return { ok: true, id, launched: false };

    // Attachments coming: startRequestPipelineFn enqueues once they are stored.
    // If the browser dies in between, the worker's sweep re-adopts the request
    // from "received" after two minutes — delaying the launch, never losing it.
    if (!data.attachmentsPending) {
      try {
        const { enqueuePipeline } = await import("@/server/queue");
        await enqueuePipeline(id);
      } catch (error) {
        // The request survives a queue failure — same sweep covers this.
        console.error(`createRequest: failed to enqueue pipeline for ${id}`, error);
      }
    }

    return { ok: true, id, launched: true };
  });

/**
 * Launch a held draft (V18): `draft → received`, then the pipeline — or,
 * while the validation step is on (V20), `draft → spec_review`: the draft is
 * presented for validation like any other request, and it is the validation
 * that launches it. A draft can only exist under that setting if it was held
 * before the step was switched on.
 *
 * The other half of `createRequestFn`'s `hold`. Deliberately NOT gated on
 * AI_CHAT: a draft held while the flag was on must still be launchable after
 * someone switches it off, or it is stranded with no way out but cancelling.
 */
export const launchDraftFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const [{ auth }, { getRequest }, { db }, { eq }, schema] = await Promise.all([
      import("@/server/auth"),
      import("@tanstack/react-start/server"),
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);
    const session = await auth.api.getSession({ headers: getRequest().headers });
    const workspaceId = session?.session.activeOrganizationId;
    if (!session || !workspaceId) return { ok: false };

    const { requireMember } = await import("@/server/workspace-guard");
    if (!(await requireMember(session.user.id, workspaceId, "buyer"))) return { ok: false };

    const row = await db.query.request.findFirst({ where: eq(schema.request.id, data.id) });
    if (!row || row.organizationId !== workspaceId || row.status !== "draft") {
      return { ok: false };
    }

    const [{ getSetting }, { entryStatus }] = await Promise.all([
      import("@/server/platform-settings"),
      import("@/lib/request-status"),
    ]);
    const entry = entryStatus(await getSetting("flow.spec_validation"));

    const { transitionRequest, StaleTransitionError } = await import("@/server/requests");
    try {
      await transitionRequest(row.id, workspaceId, "draft", entry);
    } catch (error) {
      // Two clicks, or a cancel in another tab: the request is no longer a
      // draft, and the page reloads to show where it is.
      if (error instanceof StaleTransitionError) return { ok: false };
      throw error;
    }

    // The draft's criteria are what the buyer settled on: version 1 (V19).
    try {
      const { ensureSpec } = await import("@/server/spec");
      await ensureSpec(row.id, { id: session.user.id, name: session.user.name });
    } catch (error) {
      console.error(`launchDraft: could not write the spec of ${row.id}`, error);
    }
    // Presented for validation, not launched: no audit line claiming a launch
    // and no job. `validateSpecFn` does both when the buyer approves.
    if (entry === "spec_review") return { ok: true };

    const { logAudit, actorOf } = await import("@/server/audit");
    await logAudit({
      ...actorOf(session),
      organizationId: workspaceId,
      action: "request.launched",
      target: `#${row.id}`,
    });

    try {
      const { enqueuePipeline } = await import("@/server/queue");
      await enqueuePipeline(row.id);
    } catch (error) {
      // Same as at creation: the request survives a queue failure, and the
      // worker's sweep adopts it from "received" after two minutes.
      console.error(`launchDraft: failed to enqueue pipeline for ${row.id}`, error);
    }
    return { ok: true };
  });

export type ValidateSpecResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        /** No session, a read-only seat, or someone else's request. */
        | "forbidden"
        /** Already validated, or cancelled, in another tab. */
        | "not_in_review"
        /** The specification changed after the page was loaded — an edit in
         *  another tab, a colleague, a file that finished uploading. What the
         *  buyer approved is no longer what would be launched. */
        | "stale";
    };

/**
 * The buyer validates the specification, and the search starts (V20).
 *
 * The ONE door from `spec_review` to `received`: with the validation step on,
 * a request cannot be searched without passing through here.
 *
 * `version` is the spec version the buyer had on screen. The server rebuilds
 * the spec from the request as it is now; if that is not the version they
 * approved, nothing is validated and the page shows them the current one. A
 * validation records exactly which spec and which KPI profile it covered.
 */
export const validateSpecFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string(), version: z.number().int().positive() }))
  .handler(async ({ data }): Promise<ValidateSpecResult> => {
    const [{ auth }, { getRequest }, { db }, { eq }, schema] = await Promise.all([
      import("@/server/auth"),
      import("@tanstack/react-start/server"),
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);
    const session = await auth.api.getSession({ headers: getRequest().headers });
    const workspaceId = session?.session.activeOrganizationId;
    if (!session || !workspaceId) return { ok: false, reason: "forbidden" };

    // A working seat validates; a viewer reads. Re-read per call, like every
    // other write on the dossier.
    const { requireMember } = await import("@/server/workspace-guard");
    if (!(await requireMember(session.user.id, workspaceId, "buyer"))) {
      return { ok: false, reason: "forbidden" };
    }

    const row = await db.query.request.findFirst({ where: eq(schema.request.id, data.id) });
    if (!row || row.organizationId !== workspaceId) return { ok: false, reason: "forbidden" };
    if (row.status !== "spec_review") return { ok: false, reason: "not_in_review" };

    const actor = { id: session.user.id, name: session.user.name };
    const [{ ensureSpec }, { transitionRequest, StaleTransitionError, recordEvent }] =
      await Promise.all([import("@/server/spec"), import("@/server/requests")]);

    let validated: { spec: number; profile: number };
    try {
      const outcome = await db.transaction(async (tx) => {
        // Inside the transaction and under the spec's own lock: an edit
        // racing this validation either lands first — and makes the version
        // on the buyer's screen stale — or waits and meets a request that is
        // no longer editable by the time it is weighed.
        const ensured = await ensureSpec(row.id, actor, tx);
        if (ensured.specVersion !== data.version) return { stale: true as const };
        await tx
          .update(schema.request)
          .set({
            validatedAt: new Date(),
            validatedBy: actor.id,
            validatedByName: actor.name,
            validatedSpecVersion: ensured.specVersion,
            validatedProfileVersion: ensured.profileVersion,
          })
          .where(eq(schema.request.id, row.id));
        await recordEvent(
          row.id,
          workspaceId,
          "spec.validated",
          { version: ensured.specVersion },
          tx,
        );
        await transitionRequest(row.id, workspaceId, "spec_review", "received", tx);
        return { spec: ensured.specVersion, profile: ensured.profileVersion };
      });
      if ("stale" in outcome) return { ok: false, reason: "stale" };
      validated = outcome;
    } catch (error) {
      // Two clicks, or a cancel in another tab: nothing was validated (the
      // transaction rolled back), and the page reloads to show where it is.
      if (error instanceof StaleTransitionError) return { ok: false, reason: "not_in_review" };
      throw error;
    }

    const { logAudit, actorOf } = await import("@/server/audit");
    await logAudit({
      ...actorOf(session),
      organizationId: workspaceId,
      action: "request.validated",
      target: `#${row.id}`,
      detail: { specVersion: validated.spec, profileVersion: validated.profile },
    });

    try {
      const { enqueuePipeline } = await import("@/server/queue");
      await enqueuePipeline(row.id);
    } catch (error) {
      // As at creation: the request survives a queue failure, and the
      // worker's sweep adopts it from "received" after two minutes.
      console.error(`validateSpec: failed to enqueue pipeline for ${row.id}`, error);
    }
    return { ok: true };
  });

/**
 * What the request form needs to know about the flow it feeds (V18, V20):
 * whether a new request waits for validation, and whether the form should
 * offer « Préciser avec l'assistant ». Neither is a secret — the form is
 * public — and both are the server's to decide.
 */
export const getIntakeOptionsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ validation: boolean; clarify: boolean }> => {
    const [{ chatEnabled }, { getSetting }, { defaultSetting }] = await Promise.all([
      import("@/server/ai/flags"),
      import("@/server/platform-settings"),
      import("@/lib/platform-settings"),
    ]);
    // This runs in the loader of the PUBLIC landing page, which until V20
    // touched no table for an anonymous visitor. It must not be the reason
    // that page fails: if the setting cannot be read, the form shows the
    // default's wording. Nothing is decided here — `createRequestFn` reads
    // the setting itself when the request is actually created. (Caught by
    // scripts/verify-build.sh, which boots the bundle with no database: the
    // landing answered 500.)
    let validation = defaultSetting("flow.spec_validation") === "on";
    try {
      validation = (await getSetting("flow.spec_validation")) === "on";
    } catch (error) {
      console.error("getIntakeOptions: could not read flow.spec_validation", error);
    }
    // The form's second button holds a draft for the assistant. With the
    // validation step on, every request already stops before the search and
    // the assistant is offered there — the button would be a second stop.
    return { validation, clarify: chatEnabled() && !validation };
  },
);

/** Start the pipeline for a request whose attachments have finished uploading.
 *  Idempotent: pg-boss dedupes nothing, so the worker's own "already has
 *  matches / already researched" guards are what make a double call harmless. */
export const startRequestPipelineFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const [{ auth }, { getRequest }, { db }, { eq }, schema] = await Promise.all([
      import("@/server/auth"),
      import("@tanstack/react-start/server"),
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);
    const session = await auth.api.getSession({ headers: getRequest().headers });
    const workspaceId = session?.session.activeOrganizationId;
    if (!session || !workspaceId) return { ok: false };

    const { requireMember } = await import("@/server/workspace-guard");
    if (!(await requireMember(session.user.id, workspaceId, "buyer"))) return { ok: false };

    const row = await db.query.request.findFirst({ where: eq(schema.request.id, data.id) });
    if (!row || row.organizationId !== workspaceId || row.status !== "received") {
      return { ok: false };
    }

    const { enqueuePipeline } = await import("@/server/queue");
    await enqueuePipeline(row.id);
    return { ok: true };
  });

/** Full request detail — criteria, chat, events, attachments. Same visibility
 *  rules as getRequestFn (own workspace, or employee cross-workspace read). */
export const getRequestDetailFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }): Promise<RequestDetail | null> => {
    const [{ auth }, { getRequest }, { db }, { asc, count, desc, eq }, schema] = await Promise.all([
      import("@/server/auth"),
      import("@tanstack/react-start/server"),
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);
    const session = await auth.api.getSession({ headers: getRequest().headers });
    const workspaceId = session?.session.activeOrganizationId;
    if (!session || !workspaceId) return null;

    const row = await db.query.request.findFirst({
      where: eq(schema.request.id, data.id),
    });
    if (!row) return null;

    const isOwn = row.organizationId === workspaceId;
    if (!isOwn) {
      // Cross-tenant read: staff powers only from the internal workspace.
      const { effectiveHasPermission } = await import("@/server/workspace-guard");
      if (!(await effectiveHasPermission(session, "requests.all"))) return null;
    }

    let workspaceName: string | null = null;
    if (!isOwn) {
      const org = await db.query.organization.findFirst({
        where: eq(schema.organization.id, row.organizationId),
      });
      workspaceName = org?.name ?? null;
    }

    const { chatEnabled } = await import("@/server/ai/flags");
    const aiChatEnabled = chatEnabled();

    const [criteria, messages, events, attachments, matches] = await Promise.all([
      db.query.requestCriterion.findMany({
        where: eq(schema.requestCriterion.requestId, row.id),
        orderBy: [asc(schema.requestCriterion.position), asc(schema.requestCriterion.createdAt)],
      }),
      // Chat off ⇒ no transcript leaves the server (data stays in the DB).
      aiChatEnabled
        ? db.query.requestMessage.findMany({
            where: eq(schema.requestMessage.requestId, row.id),
            orderBy: [asc(schema.requestMessage.createdAt)],
          })
        : Promise.resolve([]),
      db.query.requestEvent.findMany({
        where: eq(schema.requestEvent.requestId, row.id),
        orderBy: [asc(schema.requestEvent.createdAt)],
      }),
      db
        .select({
          id: schema.requestAttachment.id,
          fileId: schema.file.id,
          filename: schema.file.filename,
          mime: schema.file.mime,
          size: schema.file.size,
        })
        .from(schema.requestAttachment)
        .innerJoin(schema.file, eq(schema.requestAttachment.fileId, schema.file.id))
        .where(eq(schema.requestAttachment.requestId, row.id)),
      db
        .select({
          id: schema.match.id,
          rank: schema.match.rank,
          compatibilityScore: schema.match.compatibilityScore,
          confidenceScore: schema.match.confidenceScore,
          riskLevel: schema.match.riskLevel,
          status: schema.match.status,
          supplierId: schema.supplier.id,
          supplierName: schema.supplier.name,
          supplierDescriptor: schema.supplier.descriptor,
          supplierCountry: schema.supplier.countryCode,
          supplierWebsite: schema.supplier.website,
          supplierSourceRef: schema.supplier.sourceRef,
        })
        .from(schema.match)
        .innerJoin(schema.supplier, eq(schema.match.supplierId, schema.supplier.id))
        .where(eq(schema.match.requestId, row.id))
        .orderBy(asc(schema.match.rank)),
    ]);

    const flow = requestFlow(
      row.status,
      events.map((event) => event.type),
    );
    const shownMatches = isOwn && !ownerSeesMatches(flow) ? [] : matches;

    const matchesCreated = [...events].reverse().find((event) => event.type === "matches.created");
    let suppliersAnalyzed: number | null = null;
    if (matchesCreated?.message) {
      try {
        const params = JSON.parse(matchesCreated.message) as { analyzed?: number };
        suppliersAnalyzed = typeof params.analyzed === "number" ? params.analyzed : null;
      } catch {
        suppliersAnalyzed = null;
      }
    }

    // How many suppliers were solicited on this need (P2).
    const [quoteRow] = await db
      .select({ value: count() })
      .from(schema.quote)
      .where(eq(schema.quote.requestId, row.id));
    const quotesForRequest = quoteRow?.value ?? 0;

    // Did the collection behind this dossier actually happen? The LATEST run
    // decides — an earlier failure followed by a good pass is not a failure.
    const [lastRun] = await db
      .select({ status: schema.researchRun.status })
      .from(schema.researchRun)
      .where(eq(schema.researchRun.requestId, row.id))
      .orderBy(desc(schema.researchRun.createdAt))
      .limit(1);
    // Report flow only: re-running reopens the SEARCH, and on the pack flow
    // the search's answer has already become a shortlist, an RFQ round and
    // offers — `report_ready → searching` there would send a released pack
    // back to the start.
    const researchFailed = flow === "report" && lastRun?.status === "failed";
    // Re-running costs money and reopens the search, so it needs a working
    // seat in the owning workspace (a viewer may read the dossier, never spend
    // on it) or staff standing in the internal workspace. Same two-sided rule
    // the fn itself enforces — this only decides whether to offer it.
    let canRerunResearch = false;
    if (researchFailed && row.status !== "cancelled" && row.status !== "closed") {
      const { requireMember, effectiveHasPermission } = await import("@/server/workspace-guard");
      canRerunResearch = isOwn
        ? (await requireMember(session.user.id, workspaceId, "buyer")) !== null
        : await effectiveHasPermission(session, "requests.all");
    }

    // Soumissions gate (owner 2026-09-14): the owning workspace's plan says
    // whether quotes may be asked. Resolved for the OWNING workspace, not the
    // caller's — a staff member reading a foreign dossier from the internal
    // plan must not see the buyer's plan as unlimited.
    const { resolvePlan } = await import("@/server/plan");
    const ownerPlan = await resolvePlan(row.organizationId);

    // Live name while the account exists; the snapshot survives deletion.
    const creator = row.createdBy
      ? await db.query.user.findFirst({
          where: eq(schema.user.id, row.createdBy),
          columns: { name: true },
        })
      : null;

    // The clarification (V18): proposals per assistant turn, and how many
    // turns are left. Both empty when the flag is off — like the transcript.
    const { clarifyTurnsLeft: turnsLeft } = await import("@/lib/clarification");
    const [{ absentBasics }, { beforeLaunch }, { getSetting }] = await Promise.all([
      import("@/lib/clarification"),
      import("@/lib/request-status"),
      import("@/server/platform-settings"),
    ]);
    const missingBasics = beforeLaunch(row.status) ? absentBasics(criteria) : [];
    const validationOn = (await getSetting("flow.spec_validation")) === "on";

    let proposals = new Map<string, ProposalView[]>();
    let clarifyTurnsLeft = 0;
    if (aiChatEnabled) {
      const { proposalsByMessage } = await import("@/server/clarification");
      proposals = await proposalsByMessage(row.id);
      clarifyTurnsLeft = turnsLeft(
        messages.filter((m) => m.role === "assistant" && m.questions !== null).length,
      );
    }

    return {
      id: row.id,
      title: row.title,
      status: row.status,
      compatibilityScore: row.compatibilityScore,
      updatedAt: row.updatedAt.toISOString(),
      workspaceName,
      organizationId: row.organizationId,
      organizationName: workspaceName ?? "",
      quoteCount: quotesForRequest,
      createdByName: creator?.name ?? row.createdByName,
      descriptionRaw: row.descriptionRaw,
      createdAt: row.createdAt.toISOString(),
      launchedAt: row.launchedAt?.toISOString() ?? null,
      completedAt: row.completedAt?.toISOString() ?? null,
      criteria: criteria.map((criterion) => ({
        id: criterion.id,
        category: criterion.category,
        label: criterion.label,
        value: criterion.value,
        unit: criterion.unit,
        required: criterion.required,
        source: criterion.source,
        position: criterion.position,
      })),
      messages: messages.map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        questions: message.questions,
        proposals: proposals.get(message.id) ?? [],
        createdAt: message.createdAt.toISOString(),
      })),
      events: events.map((event) => ({
        id: event.id,
        type: event.type,
        params: eventParams(event.message),
        createdAt: event.createdAt.toISOString(),
      })),
      attachments,
      aiChatEnabled,
      clarifyTurnsLeft,
      missingBasics,
      validated:
        row.validatedAt && row.validatedSpecVersion !== null
          ? {
              at: row.validatedAt.toISOString(),
              byName: row.validatedByName,
              specVersion: row.validatedSpecVersion,
            }
          : null,
      validationOn,
      flow,
      unfulfilledReason: row.status === "unfulfilled" ? row.unfulfilledReason : null,
      matches: shownMatches.map((m) => ({
        id: m.id,
        rank: m.rank,
        compatibilityScore: m.compatibilityScore,
        confidenceScore: m.confidenceScore,
        riskLevel: m.riskLevel,
        status: m.status,
        supplier: {
          id: m.supplierId,
          name: m.supplierName,
          descriptor: m.supplierDescriptor,
          countryCode: m.supplierCountry,
          website: m.supplierWebsite,
          sourceRef: m.supplierSourceRef,
        },
      })),
      suppliersAnalyzed,
      canEdit: isOwn,
      researchFailed,
      canRerunResearch,
      quotesPlanRequired: isOwn && !ownerPlan.quotesEnabled,
      planName: ownerPlan.name,
    };
  });

/** Buyer validated the criteria → run the pipeline (searching → … → report). */
export const launchSearchFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const [{ auth }, { getRequest }, { db }, { eq }, schema] = await Promise.all([
      import("@/server/auth"),
      import("@tanstack/react-start/server"),
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);
    const session = await auth.api.getSession({ headers: getRequest().headers });
    const workspaceId = session?.session.activeOrganizationId;
    if (!session || !workspaceId) return { ok: false };

    const { requireMember } = await import("@/server/workspace-guard");
    if (!(await requireMember(session.user.id, workspaceId, "buyer"))) return { ok: false };

    const row = await db.query.request.findFirst({
      where: eq(schema.request.id, data.id),
    });
    if (!row || row.organizationId !== workspaceId || row.status !== "analyzing") {
      return { ok: false };
    }

    // Idempotency: one launch per request (double-clicks, stale tabs).
    const { and } = await import("drizzle-orm");
    const alreadyLaunched = await db.query.requestEvent.findFirst({
      where: and(
        eq(schema.requestEvent.requestId, row.id),
        eq(schema.requestEvent.type, "search.launched"),
      ),
    });
    if (alreadyLaunched) return { ok: false };

    // Enqueue first: if it throws, no event is written and launch stays retryable.
    const { enqueuePipeline } = await import("@/server/queue");
    await enqueuePipeline(row.id);
    const { recordEvent } = await import("@/server/requests");
    await recordEvent(row.id, workspaceId, "search.launched");
    return { ok: true };
  });

/** Why a re-run was refused. Data, not an exception: the buyer has to be told
 *  which of these it was, and "nothing happened" is not an answer. */
export type RerunResearchResult =
  { ok: true } | { ok: false; reason: "forbidden" | "not_found" | "not_failed" };

/**
 * Re-run the collection for a request whose last research pass FAILED.
 *
 * Only failed. A pass that searched and honestly found nobody is an answer —
 * re-running it buys the same answer for the same money. A pass that never
 * ran is not an answer, and before 2026-09-07 the request was stuck with it
 * forever (see BACKLOG.md, "A research pass that never searched").
 *
 * Sends the request back to `searching` FIRST, then enqueues research. That
 * order matters: the research worker hands back to the pipeline queue when it
 * finishes, and the pipeline does nothing to a `report_ready` request — the
 * suppliers would land in the store and never reach the buyer's Top-N.
 */
export const rerunResearchFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }): Promise<RerunResearchResult> => {
    const [{ auth }, { getRequest }, { db }, { desc, eq }, schema] = await Promise.all([
      import("@/server/auth"),
      import("@tanstack/react-start/server"),
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);
    const session = await auth.api.getSession({ headers: getRequest().headers });
    const workspaceId = session?.session.activeOrganizationId;
    if (!session || !workspaceId) return { ok: false, reason: "forbidden" };

    const row = await db.query.request.findFirst({ where: eq(schema.request.id, data.id) });
    if (!row) return { ok: false, reason: "not_found" };

    // Same two-sided rule getRequestDetailFn used to decide whether to offer
    // the button — re-read here, because the button is a courtesy and this is
    // the enforcement.
    const { requireMember, effectiveHasPermission } = await import("@/server/workspace-guard");
    const allowed =
      row.organizationId === workspaceId
        ? (await requireMember(session.user.id, workspaceId, "buyer")) !== null
        : await effectiveHasPermission(session, "requests.all");
    if (!allowed) return { ok: false, reason: "forbidden" };

    const [lastRun] = await db
      .select({ status: schema.researchRun.status })
      .from(schema.researchRun)
      .where(eq(schema.researchRun.requestId, row.id))
      .orderBy(desc(schema.researchRun.createdAt))
      .limit(1);
    // Refuses a `running` run too, by construction: the latest would not be
    // `failed`, so a double click cannot buy two collections.
    if (lastRun?.status !== "failed") return { ok: false, reason: "not_failed" };
    // The state machine allows `report_ready → searching` and cannot tell the
    // flows apart — both end on that state. This fn can, and must: on the
    // pack flow `report_ready` is a released Decision Pack, not a report
    // built on a failed collection.
    const { flowOfRequest } = await import("@/server/request-flow");
    if ((await flowOfRequest(row.id)) === "pack") return { ok: false, reason: "not_failed" };

    const { canTransition } = await import("@/lib/request-status");
    const { recordEvent, transitionRequest } = await import("@/server/requests");
    if (row.status !== "searching") {
      if (!canTransition(row.status, "searching")) return { ok: false, reason: "not_failed" };
      await transitionRequest(row.id, row.organizationId, row.status, "searching");
    }
    await recordEvent(row.id, row.organizationId, "research.rerun");

    const { logAudit, actorOf } = await import("@/server/audit");
    await logAudit({
      ...actorOf(session),
      organizationId: row.organizationId,
      action: "research.rerun",
      target: `#${row.id}`,
    });

    const { enqueueResearch } = await import("@/server/queue");
    await enqueueResearch(row.id);
    return { ok: true };
  });

/** Cancel an in-flight request (own workspace, legal transitions only). */
export const cancelRequestFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const [{ auth }, { getRequest }, { db }, { eq }, schema] = await Promise.all([
      import("@/server/auth"),
      import("@tanstack/react-start/server"),
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);
    const session = await auth.api.getSession({ headers: getRequest().headers });
    const workspaceId = session?.session.activeOrganizationId;
    if (!session || !workspaceId) return { ok: false };

    const { requireMember } = await import("@/server/workspace-guard");
    if (!(await requireMember(session.user.id, workspaceId, "buyer"))) return { ok: false };

    const row = await db.query.request.findFirst({
      where: eq(schema.request.id, data.id),
    });
    if (!row || row.organizationId !== workspaceId) return { ok: false };

    const { canTransition } = await import("@/lib/request-status");
    if (!canTransition(row.status, "cancelled")) return { ok: false };

    const { transitionRequest, StaleTransitionError } = await import("@/server/requests");
    try {
      await transitionRequest(row.id, workspaceId, row.status, "cancelled");
    } catch (error) {
      // The request moved between the read above and this write (the worker
      // finished a stage, a round closed). Nothing was cancelled; the page
      // reloads and shows where the request really is.
      if (error instanceof StaleTransitionError) return { ok: false };
      throw error;
    }

    // Cancelled while suppliers were quoting (V07): the round closes and
    // whoever was written to is told the RFQ no longer stands. AFTER the
    // transition, so nothing can walk the request into the pack review in
    // between; and if this dies half way, the round sweep withdraws the round
    // of any request that is over. Never allowed to fail the cancel itself.
    try {
      const { withdrawOpenRounds, tellOfferHolders } = await import("@/server/rfq-window");
      await withdrawOpenRounds(row.id, { id: session.user.id, name: session.user.name });
      // Cancelled while the pack was IN REVIEW (V11): no round is open, but
      // suppliers are holding offers, and a pack is waiting on staff's desk.
      // The suppliers are told; the pack leaves the queue as `withdrawn` —
      // not `refused`, since nobody at OSI decided anything.
      if (row.status === "pack_review") await tellOfferHolders(row.id, "withdrawn");
      const { withdrawPendingPack } = await import("@/server/decision-pack");
      await withdrawPendingPack(row.id);
    } catch (error) {
      console.error(`cancelRequest: could not withdraw the open round of ${row.id}`, error);
    }

    const { logAudit, actorOf } = await import("@/server/audit");
    await logAudit({
      ...actorOf(session),
      organizationId: workspaceId,
      action: "request.cancelled",
      target: `#${row.id}`,
      detail: { from: row.status },
    });
    return { ok: true };
  });

/** A single request — same visibility rules as the list (null when forbidden). */
export const getRequestFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }): Promise<RequestSummary | null> => {
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

    const row = await db.query.request.findFirst({
      where: eq(schema.request.id, data.id),
    });
    if (!row) return null;

    const { effectiveHasPermission } = await import("@/server/workspace-guard");
    const seesAll = await effectiveHasPermission(session, "requests.all");
    const isOwn = row.organizationId === workspaceId;
    if (!isOwn && !seesAll) return null;

    let workspaceName: string | null = null;
    if (!isOwn) {
      const org = await db.query.organization.findFirst({
        where: eq(schema.organization.id, row.organizationId),
      });
      workspaceName = org?.name ?? null;
    }

    return {
      id: row.id,
      title: row.title,
      status: row.status,
      compatibilityScore: row.compatibilityScore,
      updatedAt: row.updatedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      workspaceName,
      organizationId: row.organizationId,
      organizationName: workspaceName ?? "",
      quoteCount: 0,
      createdByName: row.createdByName,
      flow: await (await import("@/server/request-flow")).flowOfRequest(row.id),
    };
  });
