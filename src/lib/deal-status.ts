// Pure state machines for the transaction spine — client- and server-safe,
// no server imports. Same shape as src/lib/request-status.ts: the tables of
// legal transitions live here, the DB writes and events live in
// src/server/deals.ts. An illegal transition throws rather than being
// silently ignored, so a bug surfaces where it happens.

import type { ContractStatus, DealStatus, QuoteStatus } from "@/database/schema";

// ── Soumission ──────────────────────────────────────────────────────────────
// requested → the buyer picked this supplier, OSI has asked
// received  → staff keyed in what came back
// accepted  → the buyer chose THIS one; the deal opens
// declined  → the supplier said no, or the buyer chose another
// expired   → the offer's validity ran out

export const QUOTE_TRANSITIONS: Record<QuoteStatus, readonly QuoteStatus[]> = {
  requested: ["received", "declined", "expired"],
  received: ["accepted", "declined", "expired"],
  // Terminal: an accepted offer is what a dossier is built on. Changing
  // supplier means a new request, not a re-acceptance (see "no splitting").
  accepted: [],
  declined: [],
  expired: [],
};

export function canTransitionQuote(from: QuoteStatus, to: QuoteStatus): boolean {
  return QUOTE_TRANSITIONS[from].includes(to);
}

/** A quote can only be compared once it holds an answer. */
export function isComparable(status: QuoteStatus): boolean {
  return status === "received" || status === "accepted";
}

// ── Dossier de transaction ──────────────────────────────────────────────────
// The parcours validated 2026-08-29, steps 10 → 15. Closure is deliberately
// TWO acts by two actors: the buyer reviews (delivered → reviewed), then
// staff close (reviewed → closed). A dossier therefore cannot be closed over
// a buyer who has not spoken.

export const DEAL_TRANSITIONS: Record<DealStatus, readonly DealStatus[]> = {
  open: ["contracting", "cancelled"],
  contracting: ["in_production", "cancelled"],
  in_production: ["shipping", "cancelled"],
  shipping: ["delivered", "cancelled"],
  delivered: ["reviewed", "cancelled"],
  // Only staff move this one, and only after the buyer's review exists.
  reviewed: ["closed"],
  closed: [],
  cancelled: [],
};

export function canTransitionDeal(from: DealStatus, to: DealStatus): boolean {
  return DEAL_TRANSITIONS[from].includes(to);
}

/** Steps 10-15 in order, for the dossier timeline. */
export const DEAL_ORDER = [
  { status: "open", stepKey: "open" },
  { status: "contracting", stepKey: "contracting" },
  { status: "in_production", stepKey: "production" },
  { status: "shipping", stepKey: "shipping" },
  { status: "delivered", stepKey: "delivered" },
  { status: "reviewed", stepKey: "reviewed" },
  { status: "closed", stepKey: "closed" },
] as const satisfies readonly { status: DealStatus; stepKey: string }[];

export function dealIndex(status: DealStatus): number {
  return DEAL_ORDER.findIndex((step) => step.status === status);
}

/** The buyer's review is what unlocks closing — never the other way round. */
export function awaitsBuyerReview(status: DealStatus): boolean {
  return status === "delivered";
}

export function awaitsStaffClosure(status: DealStatus): boolean {
  return status === "reviewed";
}

// ── Contrat ─────────────────────────────────────────────────────────────────
// The brief's §3.1 filters (Actifs · À signer · En attente · Complétés ·
// Expirés) are DERIVED from this plus the party rows — never stored columns.

export const CONTRACT_TRANSITIONS: Record<ContractStatus, readonly ContractStatus[]> = {
  draft: ["sent", "voided"],
  sent: ["partially_signed", "signed", "voided", "expired"],
  partially_signed: ["signed", "voided", "expired"],
  signed: [],
  voided: [],
  expired: ["voided"],
};

export function canTransitionContract(from: ContractStatus, to: ContractStatus): boolean {
  return CONTRACT_TRANSITIONS[from].includes(to);
}

/** What a contract's status becomes given its parties' signatures. The status
 *  is a FUNCTION of the party rows, so the `2/4` indicator and the stored
 *  status can never disagree. Only the mandatory parties gate `signed` —
 *  that is what makes a non-required party meaningful. */
export function statusFromSignatures(
  parties: readonly { required: boolean; signatureStatus: string }[],
): "sent" | "partially_signed" | "signed" {
  const mandatory = parties.filter((p) => p.required);
  const signedCount = parties.filter((p) => p.signatureStatus === "signed").length;
  const mandatorySigned = mandatory.filter((p) => p.signatureStatus === "signed").length;
  if (mandatory.length > 0 && mandatorySigned === mandatory.length) return "signed";
  return signedCount > 0 ? "partially_signed" : "sent";
}

/** The "2 / 4" the brief asks for on every row of the contract list.
 *  Counts MANDATORY signatures only: an optional party signing must not make
 *  the indicator read complete. */
export function signatureProgress(
  parties: readonly { required: boolean; signatureStatus: string }[],
): { signed: number; required: number } {
  const mandatory = parties.filter((p) => p.required);
  return {
    signed: mandatory.filter((p) => p.signatureStatus === "signed").length,
    required: mandatory.length,
  };
}

/** Expiry is read-time, never a cron and never a stored flag — the same rule
 *  the Recommandé tier follows. A contract already signed or voided is not
 *  expired, whatever its échéance says. */
export function isExpired(
  contract: { status: ContractStatus; dueAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (contract.status === "signed" || contract.status === "voided") return false;
  return contract.dueAt !== null && contract.dueAt < now;
}

/** The brief's §3.1 filter a contract belongs to, derived. */
export type ContractFilter = "actifs" | "a_signer" | "en_attente" | "completes" | "expires";

export function contractFilter(
  contract: { status: ContractStatus; dueAt: Date | null },
  parties: readonly { required: boolean; signatureStatus: string }[],
  now: Date = new Date(),
): ContractFilter {
  if (isExpired(contract, now)) return "expires";
  if (contract.status === "signed") return "completes";
  if (contract.status === "draft" || contract.status === "voided") return "actifs";
  const { signed, required } = signatureProgress(parties);
  // Nothing signed yet reads as "waiting"; a partial signature reads as
  // "still needs signatures" — which is the distinction the brief draws.
  return signed === 0 && required > 0 ? "en_attente" : "a_signer";
}
