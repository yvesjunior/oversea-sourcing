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
  /** A contract went out and the buyer's signature is what it waits on (P6). */
  { type: "contract_to_sign", hasEmail: true },
  /** Every mandatory signature is in — the contract is complete (P6). */
  { type: "contract_signed", hasEmail: true },
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
