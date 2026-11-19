// The notification-type registry (E9/E11) — one entry per `notification.type`
// the platform can emit. Drives the Paramètres → Notifications panel (which
// toggles to render) and the emitter's preference check. Adding a type =
// one entry here + i18n labels; E6's engagement updates will land the same way.
//
// Boundary that must hold: preferences gate ONLY what goes through
// src/server/notify.ts. Transactional auth mail (verification, password
// reset, invitations) is sent directly via src/server/mail.ts and is never
// silenceable — a user who muted everything can still reset their password.

export type NotificationChannelPrefs = { inApp?: boolean; email?: boolean };
/** `notification.type` → channel flags. A missing type or flag means ON —
 *  the default is today's behavior, and a new type is never born muted. */
export type NotificationPrefs = Record<string, NotificationChannelPrefs>;

export const NOTIFICATION_TYPES = [
  /** The worker's report_ready — in-app + email. */
  { type: "report_ready", hasEmail: true },
  /** Told to the inviter when an invitation is accepted — in-app only. */
  { type: "invitation_accepted", hasEmail: false },
  /** A supplier answered and staff recorded the offer (P2) — the buyer
   *  should not have to poll the Soumissions tab to find out. */
  { type: "quote_received", hasEmail: true },
  /** STAFF-facing (2026-09-07): a buyer picked suppliers and asked OSI to
   *  solicit them. The only notification here addressed to us rather than to
   *  a customer, and the one where a delay is a delay in the product itself —
   *  nothing reaches the supplier until a human sends the request. */
  { type: "quotes_requested", hasEmail: true },
  /** STAFF-facing (Phase V · V05): a pack-flow search finished and its
   *  shortlist waits for someone to confirm who is asked. Like
   *  `quotes_requested`, a delay here is a delay in the product itself —
   *  nothing reaches a supplier until a person has looked. */
  { type: "shortlist_ready", hasEmail: true },
  /** STAFF-facing (Phase V · V07): an RFQ round closed — on its target, its
   *  deadline or a colleague's decision — and the request now waits in the
   *  pack review. Sent whatever the count, zero included: a round that came
   *  back empty is exactly the one a person has to decide about. */
  { type: "rfq_window_closed", hasEmail: true },
  /** STAFF-facing (Phase V · V14): a round closed and its pack went to the
   *  client by itself — the release mode was `automatic`. Replaces
   *  `rfq_window_closed` for that round: there is nothing to review, and
   *  that is the news. */
  { type: "pack_auto_released", hasEmail: true },
  /** STAFF-facing (Phase V · V16): a supplier entered their offer in the
   *  portal. Nobody typed it in, so nobody at OSI would otherwise know it
   *  arrived. In-app only — the round's own closing email follows. */
  { type: "portal_offer_received", hasEmail: false },
  /** STAFF-facing (V16): a supplier declined an RFQ in the portal. */
  { type: "portal_rfq_declined", hasEmail: false },
  /** The Decision Pack was released (Phase V · V12) — the pack flow's
   *  counterpart of `report_ready`: the buyer's answer is there to read. */
  { type: "pack_ready", hasEmail: true },
  /** Staff refused to send a Decision Pack and the request ended
   *  `unfulfilled` (Phase V · V11). The one outcome of the pack flow in
   *  which the buyer receives nothing — so they are told, with the reason. */
  { type: "request_unfulfilled", hasEmail: true },
  /** A contract went out and the buyer's signature is what it waits on (P6). */
  { type: "contract_to_sign", hasEmail: true },
  /** Every mandatory signature is in — the contract is complete (P6). */
  { type: "contract_signed", hasEmail: true },
  /** STAFF-facing (2026-10-11): outbound mail is failing and messages are
   *  piling up in `mail_outbox`. Necessarily in-app ONLY — emailing someone
   *  to tell them email is broken is the one notification guaranteed not to
   *  arrive, and it would queue behind the very backlog it describes. */
  { type: "mail_backlog", hasEmail: false },
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number]["type"];

export function isKnownNotificationType(type: string): type is NotificationType {
  return NOTIFICATION_TYPES.some((entry) => entry.type === type);
}

export function channelEnabled(
  prefs: NotificationPrefs | null | undefined,
  type: string,
  channel: "inApp" | "email",
): boolean {
  return prefs?.[type]?.[channel] !== false;
}
