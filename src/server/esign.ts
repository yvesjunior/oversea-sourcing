// The e-signature seam (Phase P6) — for the EXTERNAL path only.
//
// Same rule as src/server/mail.ts: no domain code imports a vendor SDK. What
// makes this seam unusual is how narrow its job is, and that is deliberate.
//
// ── Why only half the signatures come through here ────────────────────────
//
// Owner, 2026-08-29: no vendor is bought. Buyer and OSI hold platform accounts
// and sign IN THE APP — an authenticated session is stronger evidence than an
// email round trip, so that half never needed a vendor and does not route
// through this file at all. Everyone else (supplier, carrier, customs broker,
// inspector) has no login, so their signature arrives as a countersigned PDF
// that staff upload: the `manual` provider below.
//
// If a vendor is ever bought it replaces `manual` HERE and touches nothing
// else — the contract_party row, the event trail and the N/M indicator do not
// care which provider produced a signature.

export type SignatureRequest = {
  contractId: string;
  contractNumber: string;
  partyId: string;
  partyName: string;
  partyEmail: string | null;
};

export type SignatureDispatch =
  /** The provider took it from here (a vendor would return this). */
  | { ok: true; delivered: true; reference: string }
  /** Nothing was dispatched: the signature will arrive out of band and staff
   *  will record it. NOT an error — it is how `manual` always answers. */
  | { ok: true; delivered: false; reason: "manual" | "no_email" };

export type EsignProvider = {
  name: string;
  request(input: SignatureRequest): Promise<SignatureDispatch>;
};

/**
 * The only provider today. It dispatches nothing and says so: OSI sends the
 * document by mail, receives it signed, and staff upload the PDF.
 *
 * It reports `no_email` separately from `manual` because the two are different
 * operational facts — "we have no address for this party" is a gap someone can
 * close, while "this party signs on paper" is the design.
 */
const manual: EsignProvider = {
  name: "manual",
  async request(input) {
    if (!input.partyEmail) return { ok: true, delivered: false, reason: "no_email" };
    return { ok: true, delivered: false, reason: "manual" };
  },
};

export function esignProvider(): EsignProvider {
  return manual;
}
