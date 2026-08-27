import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { canSeeAllRequests } from "@/lib/roles";
import type { CriteriaCategory, RequestStatus } from "@/database/schema";

/** Shape the UI consumes; E3 will extend (criteria, pipeline progress…). */
export type RequestSummary = {
  id: string;
  title: string;
  status: RequestStatus;
  compatibilityScore: number | null;
  /** ISO timestamp */
  updatedAt: string;
  /** Set only when viewing across workspaces (employees): whose dossier this is. */
  workspaceName: string | null;
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

    const rows = await db
      .select({
        id: schema.request.id,
        title: schema.request.title,
        status: schema.request.status,
        compatibilityScore: schema.request.compatibilityScore,
        updatedAt: schema.request.updatedAt,
      })
      .from(schema.request)
      .where(eq(schema.request.organizationId, workspaceId))
      .orderBy(desc(schema.request.updatedAt));

    return rows.map((row) => ({
      ...row,
      updatedAt: row.updatedAt.toISOString(),
      workspaceName: null,
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
    if (!session || !canSeeAllRequests(session.user.platformRole)) return [];
    const ownWorkspaceId = session.session.activeOrganizationId;

    const rows = await db
      .select({
        id: schema.request.id,
        title: schema.request.title,
        status: schema.request.status,
        compatibilityScore: schema.request.compatibilityScore,
        updatedAt: schema.request.updatedAt,
        workspaceName: schema.organization.name,
        organizationId: schema.request.organizationId,
      })
      .from(schema.request)
      .innerJoin(schema.organization, eq(schema.request.organizationId, schema.organization.id))
      .orderBy(desc(schema.request.updatedAt));

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      compatibilityScore: row.compatibilityScore,
      updatedAt: row.updatedAt.toISOString(),
      workspaceName: row.organizationId === ownWorkspaceId ? null : row.workspaceName,
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
  /** ISO timestamp */
  createdAt: string;
};

export type RequestEventView = {
  id: string;
  type: string;
  /** Parsed i18n interpolation params (from the JSON `message` column). */
  params: Record<string, string | number>;
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
  /** Top-5 supplier candidates, ranked (empty until the search stage ran). */
  matches: MatchView[];
  /** Size of the supplier pool scored for this request (matches.created event). */
  suppliersAnalyzed: number | null;
  /** Writes allowed — own workspace only (employees read foreign dossiers). */
  canEdit: boolean;
  /** Platform flag AI_CHAT — the assistant UI is hidden when false. */
  aiChatEnabled: boolean;
};

/** Outcome of a create attempt. A refusal is data, not an exception: the UI has
 *  to tell the buyer *why* — expired session vs daily allowance used up. */
export type CreateRequestResult =
  | { ok: true; id: string }
  | { ok: false; reason: "unauthenticated" }
  /** Authenticated but the workspace role forbids it (viewer — read-only). */
  | { ok: false; reason: "forbidden" }
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
        })
        .optional(),
      /** The client is about to upload files for this request. Hold the
       *  pipeline until it says go, so the worker doesn't research a request
       *  whose attachments have not landed yet. */
      attachmentsPending: z.boolean().optional(),
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
    const { requireMember } = await import("@/server/workspace-guard");
    if (!(await requireMember(session.user.id, workspaceId, "buyer"))) {
      return { ok: false, reason: "forbidden" };
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
          status: "draft",
          locale,
        });
        return { id };
      },
    );
    if ("ok" in outcome) return outcome;
    const id = outcome.id;

    const { recordEvent, transitionRequest } = await import("@/server/requests");
    await recordEvent(id, workspaceId, "request.created");
    await transitionRequest(id, workspaceId, "draft", "received");

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
          position: index,
        })),
      );
      await recordEvent(id, workspaceId, "criteria.extracted", { count: criteria.length });
    }

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

    return { ok: true, id };
  });

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
    const [{ auth }, { getRequest }, { db }, { asc, eq }, schema] = await Promise.all([
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
    if (!isOwn && !canSeeAllRequests(session.user.platformRole)) return null;

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

    return {
      id: row.id,
      title: row.title,
      status: row.status,
      compatibilityScore: row.compatibilityScore,
      updatedAt: row.updatedAt.toISOString(),
      workspaceName,
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
        createdAt: message.createdAt.toISOString(),
      })),
      events: events.map((event) => {
        let params: Record<string, string | number> = {};
        if (event.message) {
          try {
            params = JSON.parse(event.message) as Record<string, string | number>;
          } catch {
            params = {};
          }
        }
        return { id: event.id, type: event.type, params, createdAt: event.createdAt.toISOString() };
      }),
      attachments,
      aiChatEnabled,
      matches: matches.map((m) => ({
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

    const { transitionRequest } = await import("@/server/requests");
    await transitionRequest(row.id, workspaceId, row.status, "cancelled");
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

    const seesAll = canSeeAllRequests(session.user.platformRole);
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
      workspaceName,
    };
  });
