// The `manual` partner provider (Phase V · V21) — the first, and the only one.
//
// A person at the partner does the work: staff write to them, or they sign in
// to the Partner Hub (V23), and what they answer is recorded by whoever
// received it. Nothing is sent to a system, because there is no system.
//
// It exists so that the adapter is real before any integration is: every
// operation the platform will one day perform against an API is already
// performed against this, and answers truthfully — "nothing was handed over,
// a person will" — instead of pretending.
//
// DO NOT import this file from domain code. `adapterFor()` in ./adapter.ts is
// the only way in. And do not write an escrow or a freight client here: a
// provider with a contract, a key or money behind it is a decision, and for
// anything financial a legal opinion first (README §2c).

import type { PartnerAdapter } from "./adapter";

export const manualProvider: PartnerAdapter = {
  provider: "manual",

  // Opening a case hands nothing over: the case is a row on our side, and the
  // partner hears of it from a person or sees it in the Partner Hub.
  async createCase() {
    return { ok: true, handedOver: false, reason: "manual" };
  },

  async requestDocument() {
    return { ok: true, delivered: false, reason: "manual" };
  },

  // The partner has no system to ask: the platform's own record is the status.
  async getStatus() {
    return null;
  },

  // Nowhere to send anyone but our own pages.
  redirectUrl() {
    return null;
  },

  // A manual partner calls nobody back. Refused, not ignored: a webhook
  // arriving for a provider that sends none is somebody else's request.
  async receiveWebhook() {
    return { ok: false, reason: "unsupported" };
  },
};
