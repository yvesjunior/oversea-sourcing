// The Transaction Room (Phase V · V25) — the rows.
//
// One dossier, four readers. This file finds out WHICH reader is asking,
// loads the whole dossier, and hands both to `projectDossier`
// (src/lib/dossier.ts), which is where what each one sees is decided. Nothing
// here returns a dossier that has not been through that function.
//
// A reader is one of three things, and each arrives through its own guard:
//
//   workspace   a buyer's member, or OSI's staff — `auth.api.getSession`
//   supplier    a supplier's person — `requireSupplierSession`
//   partner     a partner's person — `requirePartnerSession`
//
// What a reader IS on a given dossier is its `deal_party` row. A supplier
// that is not a party to the dossier, a partner that was never added to it, a
// buyer of another workspace: all read "no such dossier".

import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import {
  PARTY_ROLE_OF,
  documentAudience,
  dossierIsLive,
  mayRead,
  mayUpload,
  projectDossier,
  threadParties,
  type DossierAudience,
  type DossierParty,
  type DossierView,
  type FullDossier,
} from "@/lib/dossier";
import type { CaseFacts } from "@/lib/partner-need";
import type { PartnerKind } from "@/lib/partners";
import { specCriterionLine } from "@/lib/request-spec";
import { logAudit } from "@/server/audit";
import { recordDealEvent } from "@/server/deals";
import type { Executor } from "@/server/requests";
import { specForReading } from "@/server/spec";

/** Who is asking — built by the callers, each from its own guard. */
export type DossierReader = { userId: string; userName: string } & (
  | { kind: "workspace"; workspaceId: string; staff: boolean }
  | { kind: "supplier"; supplierIds: string[] }
  | { kind: "partner"; partnerIds: string[] }
);

type DealRow = typeof schema.deal.$inferSelect;
type PartyRow = typeof schema.dealParty.$inferSelect;

// ── parties ─────────────────────────────────────────────────────────────────

/**
 * Put the three founding parties on a dossier: the buyer's workspace, OSI and
 * the supplier. Called when a deal opens, and again — harmlessly — the first
 * time a dossier opened before V25 is read: it adds only the roles missing.
 */
export async function openParties(
  deal: Pick<DealRow, "id" | "organizationId" | "supplierId" | "supplierName">,
  executor: Executor = db,
): Promise<void> {
  const existing = await executor
    .select({ role: schema.dealParty.role })
    .from(schema.dealParty)
    .where(eq(schema.dealParty.dealId, deal.id));
  const has = new Set(existing.map((row) => row.role));
  const rows: (typeof schema.dealParty.$inferInsert)[] = [];
  if (!has.has("buyer")) {
    const [organization] = await executor
      .select({ name: schema.organization.name })
      .from(schema.organization)
      .where(eq(schema.organization.id, deal.organizationId));
    rows.push({
      id: crypto.randomUUID(),
      dealId: deal.id,
      role: "buyer",
      organizationId: deal.organizationId,
      name: organization?.name ?? "—",
    });
  }
  if (!has.has("osi")) {
    rows.push({ id: crypto.randomUUID(), dealId: deal.id, role: "osi", name: "OSI" });
  }
  if (!has.has("supplier")) {
    rows.push({
      id: crypto.randomUUID(),
      dealId: deal.id,
      role: "supplier",
      supplierId: deal.supplierId,
      name: deal.supplierName,
    });
  }
  if (rows.length > 0) await executor.insert(schema.dealParty).values(rows);
}

/**
 * DISCLOSE the buyer's identity to the supplier (decision D6).
 *
 * Before a dossier opens, a supplier reads a specification and never who is
 * buying. From this call on, the supplier's page of the dossier names the
 * buyer. It is a step — its own function, its own column, its own line on the
 * dossier's timeline — and it is called on purpose, by the code that opens a
 * deal or by a staff member: nothing else makes the name appear.
 *
 * Idempotent: a dossier already disclosed keeps its first date.
 */
export async function discloseBuyer(
  dealId: string,
  by: { id: string; name: string } | null,
): Promise<boolean> {
  const [row] = await db
    .update(schema.deal)
    .set({ buyerDisclosedAt: new Date(), buyerDisclosedByName: by?.name ?? null })
    .where(and(eq(schema.deal.id, dealId), isNull(schema.deal.buyerDisclosedAt)))
    .returning({ organizationId: schema.deal.organizationId });
  if (!row) {
    // Already disclosed — or no such dossier. Only the first is a success.
    const existing = await db.query.deal.findFirst({
      where: eq(schema.deal.id, dealId),
      columns: { buyerDisclosedAt: true },
    });
    return existing?.buyerDisclosedAt != null;
  }
  await recordDealEvent(dealId, row.organizationId, "buyer.disclosed");
  if (by) {
    await logAudit({
      actorId: by.id,
      actorName: by.name,
      organizationId: row.organizationId,
      action: "dossier.buyer_disclosed",
      target: dealId,
    });
  }
  return true;
}

export type PartyWriteResult =
  | { ok: true }
  | {
      ok: false;
      reason: "not_found" | "partner_not_found" | "partner_inactive" | "already_party" | "closed";
    };

/** Staff put a partner on the dossier: from then on its people see the
 *  dossier in the Partner Hub — its own slice of it. */
export async function addPartnerParty(
  dealId: string,
  partnerId: string,
  actor: { id: string; name: string },
): Promise<PartyWriteResult> {
  const [deal, partner] = await Promise.all([
    db.query.deal.findFirst({ where: eq(schema.deal.id, dealId) }),
    db.query.partner.findFirst({ where: eq(schema.partner.id, partnerId) }),
  ]);
  if (!deal) return { ok: false, reason: "not_found" };
  if (!dossierIsLive(deal.status)) return { ok: false, reason: "closed" };
  if (!partner) return { ok: false, reason: "partner_not_found" };
  if (!partner.active) return { ok: false, reason: "partner_inactive" };
  const inserted = await db
    .insert(schema.dealParty)
    .values({
      id: crypto.randomUUID(),
      dealId,
      role: PARTY_ROLE_OF[partner.kind],
      partnerId: partner.id,
      name: partner.name,
      addedBy: actor.id,
      addedByName: actor.name,
    })
    .onConflictDoNothing()
    .returning({ id: schema.dealParty.id });
  if (inserted.length === 0) return { ok: false, reason: "already_party" };
  await recordDealEvent(dealId, deal.organizationId, "party.added", { kind: partner.kind });
  await logAudit({
    actorId: actor.id,
    actorName: actor.name,
    organizationId: deal.organizationId,
    action: "dossier.party_added",
    target: partner.name,
    detail: { dealId, kind: partner.kind },
  });
  return { ok: true };
}

/** The partners already on a dossier — for staff's "add a partner" list. */
export async function partnerIdsOn(dealId: string): Promise<Set<string>> {
  const rows = await db
    .select({ partnerId: schema.dealParty.partnerId })
    .from(schema.dealParty)
    .where(eq(schema.dealParty.dealId, dealId));
  return new Set(rows.map((row) => row.partnerId).filter((id): id is string => id !== null));
}

// ── loading ─────────────────────────────────────────────────────────────────

async function partiesOf(dealIds: readonly string[]): Promise<PartyRow[]> {
  if (dealIds.length === 0) return [];
  return db
    .select()
    .from(schema.dealParty)
    .where(inArray(schema.dealParty.dealId, [...dealIds]))
    .orderBy(asc(schema.dealParty.createdAt));
}

/**
 * What this reader is on this dossier — or null when it is nothing to them.
 * The ONE place a reader is matched to a party.
 */
function audienceOf(
  reader: DossierReader,
  deal: Pick<DealRow, "organizationId">,
  parties: readonly PartyRow[],
  partnerKinds: ReadonlyMap<string, PartnerKind>,
): DossierAudience | null {
  if (reader.kind === "workspace") {
    if (reader.staff) return { kind: "staff" };
    if (deal.organizationId !== reader.workspaceId) return null;
    const own = parties.find((party) => party.role === "buyer");
    return own ? { kind: "buyer", partyId: own.id } : null;
  }
  if (reader.kind === "supplier") {
    const own = parties.find(
      (party) =>
        party.role === "supplier" &&
        party.supplierId !== null &&
        reader.supplierIds.includes(party.supplierId),
    );
    return own ? { kind: "supplier", partyId: own.id } : null;
  }
  const own = parties.find(
    (party) => party.partnerId !== null && reader.partnerIds.includes(party.partnerId),
  );
  const kind = own?.partnerId ? partnerKinds.get(own.partnerId) : undefined;
  return own && kind ? { kind: "partner", partyId: own.id, partnerKind: kind } : null;
}

async function kindsOf(parties: readonly PartyRow[]): Promise<Map<string, PartnerKind>> {
  const ids = parties.map((party) => party.partnerId).filter((id): id is string => id !== null);
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: schema.partner.id, kind: schema.partner.kind })
    .from(schema.partner)
    .where(inArray(schema.partner.id, ids));
  return new Map(rows.map((row) => [row.id, row.kind]));
}

type Loaded = {
  deal: DealRow;
  parties: PartyRow[];
  dossierParties: DossierParty[];
  audience: DossierAudience;
};

/**
 * The dossier's rows and what the reader is on it. Null = not theirs.
 *
 * Exported for the modules that write to a dossier (milestones, V27): they
 * start from the same question — WHO is this reader on this dossier — and
 * must not answer it a second way.
 */
export async function openDossier(reader: DossierReader, dealId: string): Promise<Loaded | null> {
  return open(reader, dealId);
}

export type OpenedDossier = Loaded;

async function open(reader: DossierReader, dealId: string): Promise<Loaded | null> {
  const deal = await db.query.deal.findFirst({ where: eq(schema.deal.id, dealId) });
  if (!deal) return null;
  // A dossier opened before V25 has no parties yet: give it its three.
  await openParties(deal);
  const parties = await partiesOf([deal.id]);
  const kinds = await kindsOf(parties);
  const audience = audienceOf(reader, deal, parties, kinds);
  if (!audience) return null;
  return {
    deal,
    parties,
    audience,
    dossierParties: parties.map((party) => ({
      id: party.id,
      role: party.role,
      name: party.name,
      partnerKind: party.partnerId ? (kinds.get(party.partnerId) ?? null) : null,
    })),
  };
}

async function full(loaded: Loaded): Promise<FullDossier> {
  const { deal } = loaded;
  const quote = deal.quoteId
    ? await db.query.quote.findFirst({ where: eq(schema.quote.id, deal.quoteId) })
    : null;
  const [spec, supplier, documents, threads, milestones, issues] = await Promise.all([
    deal.requestId ? specForReading(deal.requestId, quote?.specVersion ?? null) : null,
    deal.supplierId
      ? db.query.supplier.findFirst({
          where: eq(schema.supplier.id, deal.supplierId),
          columns: { countryCode: true },
        })
      : null,
    db
      .select({ document: schema.document, file: schema.file })
      .from(schema.document)
      .innerJoin(schema.file, eq(schema.file.id, schema.document.fileId))
      .where(eq(schema.document.dealId, deal.id)),
    db.select().from(schema.messageThread).where(eq(schema.messageThread.dealId, deal.id)),
    db.select().from(schema.orderMilestone).where(eq(schema.orderMilestone.dealId, deal.id)),
    db.select().from(schema.dealIssue).where(eq(schema.dealIssue.dealId, deal.id)),
  ]);
  const messages =
    threads.length === 0
      ? []
      : await db
          .select()
          .from(schema.message)
          .where(
            inArray(
              schema.message.threadId,
              threads.map((thread) => thread.id),
            ),
          )
          .orderBy(asc(schema.message.createdAt));

  const facts: CaseFacts = {
    goods: {
      title: spec?.title ?? deal.title,
      lines: (spec?.criteria ?? []).map((c) =>
        specCriterionLine({ label: c.label, value: c.value, unit: c.unit }),
      ),
    },
    quantity: quote?.quantity ?? null,
    origin: supplier?.countryCode ?? null,
    incoterm: deal.incoterm,
    lead_time: quote?.leadTimeDays ?? null,
    goods_value:
      deal.amountCents !== null && deal.currency
        ? { amountCents: deal.amountCents, currency: deal.currency }
        : null,
    supplier_identity: deal.supplierName,
  };
  return {
    deal: {
      id: deal.id,
      title: deal.title,
      status: deal.status,
      openedAt: deal.openedAt.toISOString(),
      requestId: deal.requestId,
      buyerDisclosedAt: deal.buyerDisclosedAt ? deal.buyerDisclosedAt.toISOString() : null,
    },
    offer: {
      amountCents: deal.amountCents,
      currency: deal.currency,
      incoterm: deal.incoterm,
      quantity: quote?.quantity ?? null,
      moq: quote?.moq ?? null,
      leadTimeDays: quote?.leadTimeDays ?? null,
      paymentTerms: quote?.paymentTerms ?? null,
    },
    facts,
    parties: loaded.dossierParties,
    documents: documents.map(({ document, file }) => ({
      id: document.id,
      fileId: file.id,
      filename: file.filename,
      size: Number(file.size),
      label: document.label,
      version: document.version,
      supersedesId: document.supersedesId,
      sharedWith: document.sharedWith ?? [],
      uploadedByName: document.uploadedByName,
      createdAt: document.createdAt.toISOString(),
      milestoneId: document.milestoneId,
    })),
    milestones: milestones.map((milestone) => ({
      id: milestone.id,
      kind: milestone.kind,
      plannedAt: milestone.plannedAt ? milestone.plannedAt.toISOString() : null,
      completedAt: milestone.completedAt ? milestone.completedAt.toISOString() : null,
      note: milestone.note,
      channel: milestone.channel,
      updatedByName: milestone.updatedByName,
      updatedAt: milestone.updatedAt.toISOString(),
    })),
    issues: issues.map((issue) => ({
      id: issue.id,
      kind: issue.kind,
      description: issue.description,
      status: issue.status,
      raisedByName: issue.raisedByName,
      raisedByRole: issue.raisedByRole,
      raisedByPartyId: issue.raisedByPartyId,
      resolution: issue.resolution,
      resolvedAt: issue.resolvedAt ? issue.resolvedAt.toISOString() : null,
      createdAt: issue.createdAt.toISOString(),
    })),
    threads: threads.map((thread) => ({
      id: thread.id,
      subject: thread.subject,
      parties: thread.parties,
      createdAt: thread.createdAt.toISOString(),
      lastMessageAt: thread.lastMessageAt.toISOString(),
      messages: messages
        .filter((message) => message.threadId === thread.id)
        .map((message) => ({
          id: message.id,
          authorName: message.authorName,
          authorRole: message.authorRole,
          authorPartyId: message.authorPartyId,
          body: message.body,
          createdAt: message.createdAt.toISOString(),
        })),
    })),
  };
}

/** One dossier, as this reader may see it. Null when it is not theirs —
 *  the same answer as a dossier that does not exist. */
export async function readDossier(
  reader: DossierReader,
  dealId: string,
): Promise<DossierView | null> {
  const loaded = await open(reader, dealId);
  if (!loaded) return null;
  return projectDossier(await full(loaded), loaded.audience);
}

export type DossierSummary = {
  id: string;
  title: string;
  status: schema.DealStatus;
  openedAt: string;
  /** The reader's role on it. */
  role: schema.ContractPartyRole;
  /**
   * The other side, when this reader may know it: the supplier for the buyer
   * and for staff; for staff also the buyer's workspace. Null for a supplier
   * and a partner — the list names nobody to them.
   */
  supplierName: string | null;
  buyerName: string | null;
};

/** The dossiers this reader is on, newest first. */
export async function listDossiers(reader: DossierReader): Promise<DossierSummary[]> {
  let deals: DealRow[];
  if (reader.kind === "workspace") {
    deals = await db
      .select()
      .from(schema.deal)
      .where(reader.staff ? undefined : eq(schema.deal.organizationId, reader.workspaceId))
      .orderBy(desc(schema.deal.openedAt));
  } else {
    const mine =
      reader.kind === "supplier"
        ? reader.supplierIds.length === 0
          ? []
          : await db
              .select({ dealId: schema.dealParty.dealId })
              .from(schema.dealParty)
              .where(
                and(
                  eq(schema.dealParty.role, "supplier"),
                  inArray(schema.dealParty.supplierId, reader.supplierIds),
                ),
              )
        : reader.partnerIds.length === 0
          ? []
          : await db
              .select({ dealId: schema.dealParty.dealId })
              .from(schema.dealParty)
              .where(inArray(schema.dealParty.partnerId, reader.partnerIds));
    const ids = [...new Set(mine.map((row) => row.dealId))];
    deals =
      ids.length === 0
        ? []
        : await db
            .select()
            .from(schema.deal)
            .where(inArray(schema.deal.id, ids))
            .orderBy(desc(schema.deal.openedAt));
  }
  if (deals.length === 0) return [];
  // Dossiers opened before V25 get their parties the first time they are
  // listed, so a buyer's list and a dossier's page never disagree.
  for (const deal of deals) await openParties(deal);
  const parties = await partiesOf(deals.map((deal) => deal.id));
  const kinds = await kindsOf(parties);
  const summaries: DossierSummary[] = [];
  for (const deal of deals) {
    const own = parties.filter((party) => party.dealId === deal.id);
    const audience = audienceOf(reader, deal, own, kinds);
    if (!audience) continue;
    const role =
      audience.kind === "staff"
        ? "osi"
        : (own.find((party) => party.id === audience.partyId)?.role ?? "other");
    const known = audience.kind === "staff" || audience.kind === "buyer";
    summaries.push({
      id: deal.id,
      title: deal.title,
      status: deal.status,
      openedAt: deal.openedAt.toISOString(),
      role,
      supplierName: known ? deal.supplierName : null,
      buyerName:
        audience.kind === "staff"
          ? (own.find((party) => party.role === "buyer")?.name ?? null)
          : null,
    });
  }
  return summaries;
}

// ── exchanges ───────────────────────────────────────────────────────────────

export type DossierWriteResult =
  | { ok: true; id: string }
  | {
      ok: false;
      reason:
        /** Not theirs, or no such dossier / thread. One answer for both. */
        | "not_found"
        /** The dossier is closed or cancelled. */
        | "closed"
        /** The parties asked for are not parties of this dossier. */
        | "bad_parties"
        | "forbidden";
    };

function authorOf(loaded: Loaded): { role: schema.ContractPartyRole; partyId: string | null } {
  if (loaded.audience.kind === "staff") return { role: "osi", partyId: null };
  const partyId = loaded.audience.partyId;
  const own = loaded.parties.find((party) => party.id === partyId);
  return { role: own?.role ?? "other", partyId };
}

/** Open a thread, with its first message. Who it is with is decided by
 *  `threadParties`: staff choose, every other side talks to OSI. */
export async function createThread(
  reader: DossierReader,
  dealId: string,
  input: { subject: string; parties: string[]; body: string },
): Promise<DossierWriteResult> {
  const loaded = await open(reader, dealId);
  if (!loaded) return { ok: false, reason: "not_found" };
  if (!dossierIsLive(loaded.deal.status)) return { ok: false, reason: "closed" };
  const parties = threadParties(loaded.audience, input.parties, loaded.dossierParties);
  if (!parties) return { ok: false, reason: "bad_parties" };
  const author = authorOf(loaded);
  const threadId = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(schema.messageThread).values({
      id: threadId,
      dealId,
      subject: input.subject,
      parties,
      createdBy: reader.userId,
      createdByName: reader.userName,
    });
    await tx.insert(schema.message).values({
      id: crypto.randomUUID(),
      threadId,
      authorId: reader.userId,
      authorName: reader.userName,
      authorRole: author.role,
      authorPartyId: author.partyId,
      body: input.body,
    });
  });
  return { ok: true, id: threadId };
}

/** Answer in a thread the reader is in. A thread they are not in is "not
 *  found" — they are not told it exists. */
export async function postMessage(
  reader: DossierReader,
  threadId: string,
  body: string,
): Promise<DossierWriteResult> {
  const thread = await db.query.messageThread.findFirst({
    where: eq(schema.messageThread.id, threadId),
  });
  if (!thread) return { ok: false, reason: "not_found" };
  const loaded = await open(reader, thread.dealId);
  if (!loaded || !mayRead(loaded.audience, thread.parties)) {
    return { ok: false, reason: "not_found" };
  }
  if (!dossierIsLive(loaded.deal.status)) return { ok: false, reason: "closed" };
  const author = authorOf(loaded);
  const id = crypto.randomUUID();
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx.insert(schema.message).values({
      id,
      threadId,
      authorId: reader.userId,
      authorName: reader.userName,
      authorRole: author.role,
      authorPartyId: author.partyId,
      body,
      createdAt: now,
    });
    await tx
      .update(schema.messageThread)
      .set({ lastMessageAt: now })
      .where(eq(schema.messageThread.id, threadId));
  });
  return { ok: true, id };
}

// ── documents ───────────────────────────────────────────────────────────────

export type UploadPlan =
  | {
      ok: true;
      deal: DealRow;
      sharedWith: string[];
      /** The version being replaced, when this upload is a new version. */
      supersedes: { id: string; version: number; label: string | null } | null;
    }
  | { ok: false; reason: "not_found" | "closed" | "forbidden" | "bad_parties" };

/**
 * May this reader add a document to this dossier, and who will read it?
 *
 * Asked by the upload route BEFORE a byte is stored. A new version inherits
 * the audience of the version it replaces — replacing a document must not
 * quietly widen who reads it — and can only replace one the reader may read.
 */
export async function planUpload(
  reader: DossierReader,
  dealId: string,
  input: { sharedWith: string[]; supersedesId: string | null },
): Promise<UploadPlan> {
  const loaded = await open(reader, dealId);
  if (!loaded) return { ok: false, reason: "not_found" };
  if (!dossierIsLive(loaded.deal.status)) return { ok: false, reason: "closed" };
  if (!mayUpload(loaded.audience)) return { ok: false, reason: "forbidden" };

  if (input.supersedesId) {
    const previous = await db.query.document.findFirst({
      where: and(eq(schema.document.id, input.supersedesId), eq(schema.document.dealId, dealId)),
    });
    if (!previous || !mayRead(loaded.audience, previous.sharedWith ?? [])) {
      return { ok: false, reason: "not_found" };
    }
    return {
      ok: true,
      deal: loaded.deal,
      sharedWith: previous.sharedWith ?? [],
      supersedes: { id: previous.id, version: previous.version, label: previous.label },
    };
  }
  const sharedWith = documentAudience(loaded.audience, input.sharedWith, loaded.dossierParties);
  if (!sharedWith) return { ok: false, reason: "bad_parties" };
  return { ok: true, deal: loaded.deal, sharedWith, supersedes: null };
}

/**
 * The file behind a dossier document, if this reader may read that document.
 * Someone else's file and no such file answer alike.
 */
export async function fileForDossier(reader: DossierReader, fileId: string) {
  const [row] = await db
    .select({ file: schema.file, document: schema.document })
    .from(schema.file)
    .innerJoin(schema.document, eq(schema.document.fileId, schema.file.id))
    .where(eq(schema.file.id, fileId));
  if (!row?.document.dealId) return null;
  const loaded = await open(reader, row.document.dealId);
  if (!loaded || !mayRead(loaded.audience, row.document.sharedWith ?? [])) return null;
  return row.file;
}

/**
 * May the OWNING workspace read this file through `/api/files`? (V25)
 *
 * A dossier's documents sit in the buyer's workspace — ownership follows the
 * paperwork — and the workspace's own download route would hand every one of
 * them to the buyer. This is the rule that route asks: a dossier document is
 * the buyer's to read only when it is shared with the buyer's party. True for
 * a file that is not a dossier document at all: not this rule's business.
 */
export async function buyerMayReadFile(fileId: string): Promise<boolean> {
  const rows = await db
    .select({ dealId: schema.document.dealId, sharedWith: schema.document.sharedWith })
    .from(schema.document)
    .where(eq(schema.document.fileId, fileId));
  const ofDossier = rows.filter((row) => row.dealId !== null);
  if (ofDossier.length === 0) return true;
  const buyers = await db
    .select({ id: schema.dealParty.id, dealId: schema.dealParty.dealId })
    .from(schema.dealParty)
    .where(
      and(
        eq(schema.dealParty.role, "buyer"),
        inArray(
          schema.dealParty.dealId,
          ofDossier.map((row) => row.dealId as string),
        ),
      ),
    );
  return ofDossier.every((row) => {
    const buyer = buyers.find((party) => party.dealId === row.dealId);
    return buyer !== undefined && (row.sharedWith ?? []).includes(buyer.id);
  });
}
