// The partner adapter (Phase V · V21) — the ONE seam between the platform
// and whoever a partner really is.
//
// Same rule as `src/server/mail.ts` and `src/server/esign.ts`: no domain code
// imports a provider. A case is opened, a document asked for, a status read —
// through `adapterFor(partner.provider)`, never through `./manual` directly.
// `partners.test.ts` reads the source and fails if anything else imports it.
//
// The five operations are the ones the V6 document names. They are written
// for the general case — a partner with an API, a hosted page, a webhook —
// and the only provider today answers most of them with "a person will":
// see `./manual.ts`.

import type { PartnerKind, PartnerProvider } from "@/lib/partners";
import { manualProvider } from "./manual";

/** The partner, as much of it as a provider needs. */
export type PartnerRef = {
  id: string;
  name: string;
  kind: PartnerKind;
  contactEmail: string | null;
};

/** What a case is opened about. Deliberately small: the provider is told
 *  what it needs to start, and asks for the rest through the case itself. */
export type CaseRequest = {
  caseId: string;
  partner: PartnerRef;
  /** OSI's reference for the dossier — never the buyer's name. */
  reference: string;
  summary: string;
};

export type CaseOpened =
  /** The provider has it: `externalRef` is ITS id for the case. */
  | { ok: true; handedOver: true; externalRef: string }
  /** Nothing was sent anywhere: a person will be told, and what they answer
   *  will be recorded. NOT an error — it is how `manual` always answers. */
  | { ok: true; handedOver: false; reason: "manual" };

export type DocumentRequest = { caseId: string; partner: PartnerRef; what: string };
export type DocumentRequested =
  | { ok: true; delivered: true; reference: string }
  | { ok: true; delivered: false; reason: "manual" };

/** A provider's view of where a case stands; null = it has no view of its
 *  own, and the platform's record is the only one. */
export type ProviderStatus = { status: string; at: Date } | null;

export type WebhookResult =
  | { ok: true; caseId: string; status: string }
  /** This provider sends none, or the payload was not one of its own. */
  | { ok: false; reason: "unsupported" | "unrecognised" };

export type PartnerAdapter = {
  provider: PartnerProvider;
  /** Hand a new case to the partner. */
  createCase(input: CaseRequest): Promise<CaseOpened>;
  /** Ask the partner for a document on a case. */
  requestDocument(input: DocumentRequest): Promise<DocumentRequested>;
  /** Where the partner says the case stands. */
  getStatus(input: { caseId: string; externalRef: string | null }): Promise<ProviderStatus>;
  /** Where to send a person to act on the case at the partner's — null when
   *  there is nowhere but our own Partner Hub. */
  redirectUrl(input: { caseId: string; externalRef: string | null }): string | null;
  /** The partner calls back. */
  receiveWebhook(input: { headers: Headers; body: string }): Promise<WebhookResult>;
};

const ADAPTERS: Record<PartnerProvider, PartnerAdapter> = {
  manual: manualProvider,
};

/** The adapter for a partner's provider — the only way to a provider. */
export function adapterFor(provider: PartnerProvider): PartnerAdapter {
  return ADAPTERS[provider];
}
