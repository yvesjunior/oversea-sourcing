// The Transaction Room (Phase V · V25) — who sees what. Pure and client-safe.
//
// One dossier, four readers: the buyer, OSI's staff, the supplier, a partner.
// Each opens "the same dossier" and gets a different page. This file is where
// that difference is decided — the server builds the WHOLE dossier and passes
// it through `projectDossier` before anything leaves, so what a reader is not
// meant to see is absent from the answer, not hidden by a page.
//
// ── The rules ───────────────────────────────────────────────────────────────
//
//  • A DOCUMENT is read by staff, and by the parties it is shared with
//    (`sharedWith`: deal_party ids). The buyer is not an exception: the file
//    sits in their workspace, and they still read it only when listed.
//  • A THREAD is read by staff, and by the parties in it (`parties`). OSI is
//    in every thread and is never listed: nothing is said on a dossier
//    without OSI. A thread between the buyer and OSI lists the buyer alone;
//    the supplier is not in the list and does not learn it exists.
//  • WHO IS NAMED TO WHOM:
//      staff      everyone.
//      buyer      OSI and the supplier. A partner is listed by what it does
//                 ("transport — a partner of OSI"), not by name: the buyer's
//                 counterpart is OSI (the rule of the Decision Pack, V22).
//      supplier   OSI; the buyer ONLY once its identity has been disclosed
//                 (decision D6 — `deal.buyer_disclosed_at`, set by an explicit
//                 step when the deal opens). Partners are not listed at all.
//      partner    OSI; the supplier only for a kind of work that needs to
//                 know whose factory it is (`partner-need.ts` — inspection).
//                 Never the buyer.
//  • THE OFFER (price, terms) is read by staff, the buyer and the supplier
//    whose offer it is. A partner gets the facts its kind of work needs
//    (`factsForCase`) — the same table as a case in the Partner Hub.
//  • NOBODY but staff reads a person's name on a message from another side:
//    a message says which PARTY spoke.
//  • A reader is told THAT other parties read a thread or a document even
//    when it is not told WHO: "and 1 other party". A shared conversation is
//    never mistaken for a private one.

import type { ContractPartyRole, DealStatus, QuoteChannel } from "@/database/schema";
import {
  MILESTONE_KINDS,
  mayRecordMilestone,
  milestoneOwner,
  milestonesOpen,
  type MilestoneKind,
} from "@/lib/milestones";
import { caseNeeds, factsForCase, type CaseFacts } from "@/lib/partner-need";
import type { PartnerKind } from "@/lib/partners";

/** The dossier role each kind of partner holds. `insurance` has no role of
 *  its own in the contracts' vocabulary and is `other`; the kind is kept on
 *  the party so nothing is lost. */
export const PARTY_ROLE_OF: Record<PartnerKind, ContractPartyRole> = {
  transport: "carrier",
  customs: "customs_broker",
  inspection: "inspector",
  insurance: "other",
  settlement: "other",
};

export type DossierAudience =
  | { kind: "staff" }
  | { kind: "buyer"; partyId: string }
  | { kind: "supplier"; partyId: string }
  | { kind: "partner"; partyId: string; partnerKind: PartnerKind };

export type DossierParty = {
  id: string;
  role: ContractPartyRole;
  name: string;
  /** Set on a partner's row. */
  partnerKind: PartnerKind | null;
};

export type DossierDocument = {
  id: string;
  fileId: string;
  filename: string;
  size: number;
  label: string | null;
  version: number;
  supersedesId: string | null;
  sharedWith: string[];
  uploadedByName: string | null;
  createdAt: string;
  /** Set on a PROOF: the milestone it is evidence of (V27). Such a document
   *  is shown under its milestone, not in the dossier's general list. */
  milestoneId?: string | null;
};

/** A milestone as recorded (V27). A kind nobody has touched has no row. */
export type DossierMilestone = {
  id: string;
  kind: MilestoneKind;
  plannedAt: string | null;
  completedAt: string | null;
  note: string | null;
  channel: QuoteChannel;
  updatedByName: string | null;
  updatedAt: string;
};

export type DossierMessage = {
  id: string;
  authorName: string;
  authorRole: ContractPartyRole;
  /** The party that spoke — null for OSI. */
  authorPartyId: string | null;
  body: string;
  createdAt: string;
};

export type DossierThread = {
  id: string;
  subject: string;
  parties: string[];
  createdAt: string;
  lastMessageAt: string;
  messages: DossierMessage[];
};

export type DossierOffer = {
  amountCents: number | null;
  currency: string | null;
  incoterm: string | null;
  quantity: string | null;
  moq: string | null;
  leadTimeDays: number | null;
  paymentTerms: string | null;
};

/** Everything the server knows about a dossier. Never sent as is. */
export type FullDossier = {
  deal: {
    id: string;
    title: string;
    status: DealStatus;
    openedAt: string;
    requestId: string | null;
    buyerDisclosedAt: string | null;
  };
  offer: DossierOffer;
  /** What a partner's work may need — cut down per kind before it is shown. */
  facts: CaseFacts;
  parties: DossierParty[];
  documents: DossierDocument[];
  threads: DossierThread[];
  /** Absent on a dossier built before V27's reader: the same as none. */
  milestones?: DossierMilestone[];
};

export type PartyView = {
  id: string;
  role: ContractPartyRole;
  partnerKind: PartnerKind | null;
  /** Null = on the dossier, and not named to this reader. */
  name: string | null;
  /** The reader's own party. */
  you: boolean;
};

export type DocumentVersionView = {
  id: string;
  fileId: string;
  filename: string;
  size: number;
  version: number;
  createdAt: string;
  /** STAFF ONLY — who put it there. */
  uploadedByName?: string | null;
};

export type DocumentView = DocumentVersionView & {
  label: string | null;
  /** The parties it is shared with, as this reader may name them. */
  sharedWith: PartyView[];
  /**
   * How many MORE parties read it that this reader is not told about. Who
   * they are is not theirs to know; THAT others read it is — nobody should
   * take a shared document, or a shared thread, for a private one.
   */
  alsoSharedWith: number;
  /** The versions it replaced, newest first — each still readable. */
  earlier: DocumentVersionView[];
};

/**
 * One step of the dossier's execution (V27), as a reader sees it. Every kind
 * is listed, in order, recorded or not: a buyer reads what has happened AND
 * what has not yet. WHERE it stands — done, late, planned — is not in here:
 * it is derived when the page is read (`milestoneState`), so a milestone
 * turns late by itself.
 */
export type MilestoneView = {
  kind: MilestoneKind;
  /** Whose work it is. */
  owner: ContractPartyRole;
  plannedAt: string | null;
  completedAt: string | null;
  /** Who typed the last update — the party itself, or OSI on its behalf.
   *  Null while nothing has been recorded. */
  channel: QuoteChannel | null;
  updatedAt: string | null;
  /** What was said about it. Not sent to a partner. */
  note?: string | null;
  /** STAFF ONLY — the person who recorded it. */
  recordedByName?: string | null;
  /** The evidence attached, for the readers it is shared with. */
  proofs: DocumentVersionView[];
  /** This reader may plan or complete it. */
  canRecord: boolean;
};

export type MessageView = {
  id: string;
  /** Which side spoke. */
  role: ContractPartyRole;
  /** The reader's own side wrote it. */
  mine: boolean;
  /** STAFF ONLY — the person. Everyone else reads which party spoke. */
  authorName?: string;
  body: string;
  createdAt: string;
};

export type ThreadView = {
  id: string;
  subject: string;
  /** Who is in it besides OSI, as this reader may name them. */
  parties: PartyView[];
  /** How many more parties are in it, unnamed to this reader (see
   *  `DocumentView.alsoSharedWith`). */
  alsoParties: number;
  lastMessageAt: string;
  messages: MessageView[];
};

export type DossierView = {
  audience: DossierAudience["kind"];
  deal: {
    id: string;
    title: string;
    status: DealStatus;
    openedAt: string;
    /** The request it came from — the buyer's and staff's to follow. */
    requestId?: string | null;
  };
  parties: PartyView[];
  /** Staff, the buyer, and the supplier whose offer it is. */
  offer?: DossierOffer;
  /** A partner: what its kind of work needs. */
  facts?: Partial<CaseFacts>;
  /**
   * Staff and the supplier: whether the buyer's identity has been disclosed
   * to the supplier, and when. Absent for the buyer and for a partner.
   */
  buyerDisclosedAt?: string | null;
  documents: DocumentView[];
  threads: ThreadView[];
  milestones: MilestoneView[];
};

// ── reading ─────────────────────────────────────────────────────────────────

/** The reader's own party id — null for staff, who read as OSI. */
function ownParty(audience: DossierAudience): string | null {
  return audience.kind === "staff" ? null : audience.partyId;
}

/** May this reader see a thing shared with `listed` parties? */
export function mayRead(audience: DossierAudience, listed: readonly string[]): boolean {
  const own = ownParty(audience);
  return own === null || listed.includes(own);
}

/**
 * How one party appears to this reader: named, listed without a name, or not
 * listed at all (null).
 */
export function partyFor(
  party: DossierParty,
  audience: DossierAudience,
  dossier: Pick<FullDossier, "deal">,
): PartyView | null {
  const you = ownParty(audience) === party.id;
  const view = (name: string | null): PartyView => ({
    id: party.id,
    role: party.role,
    partnerKind: party.partnerKind,
    name,
    you,
  });
  if (audience.kind === "staff" || you || party.role === "osi") return view(party.name);

  const isPartner = party.partnerKind !== null;
  switch (audience.kind) {
    case "buyer":
      // The supplier by name; a partner by what it does.
      return view(isPartner ? null : party.name);
    case "supplier":
      if (isPartner) return null;
      // The buyer: named only once disclosed (decision D6).
      if (party.role === "buyer") {
        return view(dossier.deal.buyerDisclosedAt !== null ? party.name : null);
      }
      return view(party.name);
    case "partner":
      if (party.role === "supplier") {
        return caseNeeds(audience.partnerKind, "supplier_identity") ? view(party.name) : null;
      }
      // Never the buyer, never another partner.
      return null;
  }
}

/** The current version of each document this reader may see, with the
 *  versions it replaced. */
export function documentChains(
  documents: readonly DossierDocument[],
  audience: DossierAudience,
): Array<{ current: DossierDocument; earlier: DossierDocument[] }> {
  const visible = documents.filter((doc) => mayRead(audience, doc.sharedWith));
  const byId = new Map(visible.map((doc) => [doc.id, doc]));
  const replaced = new Set(visible.map((doc) => doc.supersedesId).filter((id) => id !== null));
  return visible
    .filter((doc) => !replaced.has(doc.id))
    .map((current) => {
      const earlier: DossierDocument[] = [];
      // Walk back along the chain; a version this reader may not see ends it.
      for (
        let previous = current.supersedesId ? byId.get(current.supersedesId) : undefined;
        previous && !earlier.includes(previous);
        previous = previous.supersedesId ? byId.get(previous.supersedesId) : undefined
      ) {
        earlier.push(previous);
      }
      return { current, earlier };
    })
    .sort((a, b) => b.current.createdAt.localeCompare(a.current.createdAt));
}

/** The dossier as one reader may see it. */
export function projectDossier(full: FullDossier, audience: DossierAudience): DossierView {
  const staff = audience.kind === "staff";
  const own = ownParty(audience);
  const named = (ids: readonly string[]): PartyView[] =>
    full.parties
      .filter((party) => ids.includes(party.id))
      .map((party) => partyFor(party, audience, full))
      .filter((party): party is PartyView => party !== null);

  /** Parties in `ids` that exist on the dossier and are not shown to this
   *  reader at all. */
  const unnamed = (ids: readonly string[]): number =>
    full.parties.filter((party) => ids.includes(party.id) && !partyFor(party, audience, full))
      .length;

  const version = (doc: DossierDocument): DocumentVersionView => ({
    id: doc.id,
    fileId: doc.fileId,
    filename: doc.filename,
    size: doc.size,
    version: doc.version,
    createdAt: doc.createdAt,
    ...(staff ? { uploadedByName: doc.uploadedByName } : {}),
  });

  return {
    audience: audience.kind,
    deal: {
      id: full.deal.id,
      title: full.deal.title,
      status: full.deal.status,
      openedAt: full.deal.openedAt,
      ...(audience.kind === "staff" || audience.kind === "buyer"
        ? { requestId: full.deal.requestId }
        : {}),
    },
    parties: full.parties
      .map((party) => partyFor(party, audience, full))
      .filter((party): party is PartyView => party !== null),
    ...(audience.kind === "partner"
      ? { facts: factsForCase(audience.partnerKind, full.facts) }
      : { offer: full.offer }),
    ...(audience.kind === "staff" || audience.kind === "supplier"
      ? { buyerDisclosedAt: full.deal.buyerDisclosedAt }
      : {}),
    milestones: MILESTONE_KINDS.map((kind): MilestoneView => {
      const recorded = (full.milestones ?? []).find((milestone) => milestone.kind === kind);
      return {
        kind,
        owner: milestoneOwner(kind),
        plannedAt: recorded?.plannedAt ?? null,
        completedAt: recorded?.completedAt ?? null,
        channel: recorded?.channel ?? null,
        updatedAt: recorded?.updatedAt ?? null,
        // A partner is told what happened and when — not what a supplier
        // wrote about its production, nor shown its photos.
        ...(audience.kind === "partner" ? {} : { note: recorded?.note ?? null }),
        ...(staff ? { recordedByName: recorded?.updatedByName ?? null } : {}),
        proofs:
          recorded && audience.kind !== "partner"
            ? full.documents
                .filter(
                  (doc) => doc.milestoneId === recorded.id && mayRead(audience, doc.sharedWith),
                )
                .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
                .map(version)
            : [],
        canRecord: milestonesOpen(full.deal.status) && mayRecordMilestone(audience, kind),
      };
    }),
    // A proof is shown under its milestone, not in the general list.
    documents: documentChains(
      full.documents.filter((doc) => !doc.milestoneId),
      audience,
    ).map(({ current, earlier }) => ({
      ...version(current),
      label: current.label,
      sharedWith: named(current.sharedWith),
      alsoSharedWith: unnamed(current.sharedWith),
      earlier: earlier.map(version),
    })),
    threads: full.threads
      .filter((thread) => mayRead(audience, thread.parties))
      .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
      .map((thread) => ({
        id: thread.id,
        subject: thread.subject,
        parties: named(thread.parties),
        alsoParties: unnamed(thread.parties),
        lastMessageAt: thread.lastMessageAt,
        messages: thread.messages.map((message) => ({
          id: message.id,
          role: message.authorRole,
          mine: staff ? message.authorPartyId === null : message.authorPartyId === own,
          ...(staff ? { authorName: message.authorName } : {}),
          body: message.body,
          createdAt: message.createdAt,
        })),
      })),
  };
}

// ── writing ─────────────────────────────────────────────────────────────────

/**
 * Who a NEW thread may be opened with.
 *
 * Staff choose: any parties of the dossier, at least one. Everyone else opens
 * a thread with OSI and nobody else — their own party alone. Putting two
 * sides in one conversation is OSI's decision, never a side's own: that is
 * what "facilitated" means, and it is also what keeps a buyer from writing
 * to a supplier whose name it was not given.
 */
export function threadParties(
  audience: DossierAudience,
  requested: readonly string[],
  parties: readonly DossierParty[],
): string[] | null {
  if (audience.kind !== "staff") return [audience.partyId];
  const known = new Set(parties.filter((party) => party.role !== "osi").map((party) => party.id));
  const chosen = [...new Set(requested)].filter((id) => known.has(id));
  return chosen.length > 0 && chosen.length === new Set(requested).size ? chosen : null;
}

/** Who a document may be shared with, by whoever uploads it. Staff choose
 *  among the parties; a buyer's upload is shared with the buyer — staff read
 *  it anyway, and sharing it further is OSI's to do. */
export function documentAudience(
  audience: DossierAudience,
  requested: readonly string[],
  parties: readonly DossierParty[],
): string[] | null {
  if (audience.kind === "buyer") return [audience.partyId];
  if (audience.kind !== "staff") return null;
  const known = new Set(parties.filter((party) => party.role !== "osi").map((party) => party.id));
  const chosen = [...new Set(requested)].filter((id) => known.has(id));
  return chosen.length === new Set(requested).size ? chosen : null;
}

/** May this reader upload to the dossier at all? Staff and the buyer in V25;
 *  the supplier's and the partner's own uploads come with the tasks that
 *  give them something to upload (V27–V29). */
export function mayUpload(audience: DossierAudience): boolean {
  return audience.kind === "staff" || audience.kind === "buyer";
}

/** Is the dossier still open to new exchanges? */
export function dossierIsLive(status: DealStatus): boolean {
  return status !== "closed" && status !== "cancelled";
}
