// Who may sign a contract party, and by which mechanism (Phase P6).
//
// Pure and client-safe, like deal-status.ts: the rules live here, the writes
// live in src/lib/signature-fns.ts. Every refusal is a NAMED value rather than
// a boolean, so the UI can say why instead of just hiding a button — a party
// who cannot sign because the contract was never sent is in a different
// situation from one who signed an hour ago.
//
// ── The split is by WHO THE PARTY IS, not by configuration ────────────────
//
// Owner, 2026-08-29: "between buyer and staff it is tracked through the
// platform; for supplier it is manual upload for now, as the supplier is not
// logged into the platform." So the mechanism falls out of the party's ROLE —
// buyer and OSI have accounts, nobody else does — and no setting can put a
// supplier on the in-platform path while suppliers have no login.
//
// Note this keys on the role, NOT on `contract_party.user_id`. That column is
// null when a contract is drafted (we do not know WHICH member of the buyer's
// workspace will sign) and is filled at signature time with whoever actually
// did. Deciding the mechanism from a column that is null at draft would make
// every party external.

import type { ContractPartyRole, ContractStatus, SignatureMethod } from "@/database/schema";

/** The parties that hold platform accounts, and therefore sign in-app. */
export const IN_PLATFORM_ROLES: readonly ContractPartyRole[] = ["buyer", "osi"];

export function mechanismFor(role: ContractPartyRole): SignatureMethod {
  return IN_PLATFORM_ROLES.includes(role) ? "in_platform" : "manual_upload";
}

export type SignRefusal =
  /** The contract has not been sent yet — there is nothing to sign. */
  | "not_sent"
  /** Already signed, or the party declined. A signature is not re-recorded. */
  | "already_recorded"
  /** Voided or expired: the document is no longer live. */
  | "contract_closed"
  /** This party signs offline; staff upload the countersigned PDF instead. */
  | "external_party"
  /** In-platform, but the caller is not this party (wrong workspace, or not
   *  staff for the OSI line). */
  | "not_your_party"
  /** The caller IS the right side but lacks the right: a viewer seat, or a
   *  staff role the owner has not granted `contracts.sign`. */
  | "forbidden";

export type SignerContext = {
  /** The workspace the caller is standing in. */
  workspaceId: string;
  /** Their role there — a viewer may read a contract, never sign it. */
  workspaceRole: string;
  /** `contracts.sign`, resolved server-side. Owner-only by default. */
  maySignForOsi: boolean;
};

export type PartyFacts = {
  role: ContractPartyRole;
  organizationId: string | null;
  signatureStatus: string;
};

/**
 * May this caller put their name to this party's line, right now?
 *
 * Returns `"ok"` or the reason. The server fn re-runs this against freshly
 * read rows — the UI calling it first is a courtesy, never the enforcement.
 */
export function canSignInPlatform(
  contract: { status: ContractStatus },
  party: PartyFacts,
  signer: SignerContext,
): "ok" | SignRefusal {
  if (mechanismFor(party.role) === "manual_upload") return "external_party";
  if (party.signatureStatus !== "pending") return "already_recorded";
  if (contract.status === "voided" || contract.status === "expired") return "contract_closed";
  // A draft is an internal working copy: it has not gone to the parties, and
  // signing one would record consent to a document nobody was shown.
  if (contract.status === "draft") return "not_sent";

  if (party.role === "osi") {
    return signer.maySignForOsi ? "ok" : "forbidden";
  }
  // The buyer's line: only from inside the buyer's own workspace.
  if (party.organizationId !== signer.workspaceId) return "not_your_party";
  // A working seat, the same bar that accepting the offer required. Requiring
  // MORE to sign the paperwork than to commit the money would be incoherent;
  // a read-only viewer still cannot.
  return signer.workspaceRole === "viewer" ? "forbidden" : "ok";
}

/**
 * May staff record an offline signature for this party?
 *
 * The mirror image: external parties only, and only from the internal
 * workspace with `contracts.sign`.
 */
export function canRecordManual(
  contract: { status: ContractStatus },
  party: PartyFacts,
  signer: { maySignForOsi: boolean },
): "ok" | SignRefusal {
  if (mechanismFor(party.role) === "in_platform") return "not_your_party";
  if (party.signatureStatus !== "pending") return "already_recorded";
  if (contract.status === "voided" || contract.status === "expired") return "contract_closed";
  if (contract.status === "draft") return "not_sent";
  return signer.maySignForOsi ? "ok" : "forbidden";
}

/** A reminder only makes sense for a party still pending on a live contract. */
export function canRemind(
  contract: { status: ContractStatus },
  party: { signatureStatus: string },
): boolean {
  if (contract.status !== "sent" && contract.status !== "partially_signed") return false;
  return party.signatureStatus === "pending";
}
