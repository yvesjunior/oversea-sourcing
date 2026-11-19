// Partners (Phase V · V21) — the vocabulary, pure and client-safe.
//
// A partner fills a SLOT on a dossier. The slots are the kinds below
// (decision D10's default). Which of them can be used today is a separate
// question, answered by `PARTNER_KINDS_AVAILABLE`.

/**
 * What a partner does.
 *
 *   transport    moves the goods (the transit agent the owner named)
 *   inspection   checks them before they ship
 *   customs      clears them
 *   insurance    covers them in transit
 *   settlement   holds and releases the money
 */
export const PARTNER_KINDS = [
  "transport",
  "inspection",
  "customs",
  "insurance",
  "settlement",
] as const;
export type PartnerKind = (typeof PARTNER_KINDS)[number];

/**
 * The kinds a partner can be CREATED with today.
 *
 * `settlement` is in the vocabulary — it is the slot the adapter was designed
 * around — and unavailable: the money circuit waits on its legal opinion
 * (README §2c, "for anything financial, do not build it yet"; slice 6). A
 * settlement partner on file would read as a capability the platform does not
 * have. Same rule as an unimplemented option of a platform setting: shown,
 * greyed, and refused by the server.
 */
export const PARTNER_KINDS_AVAILABLE: readonly PartnerKind[] = [
  "transport",
  "inspection",
  "customs",
  "insurance",
];

export function partnerKindAvailable(kind: PartnerKind): boolean {
  return PARTNER_KINDS_AVAILABLE.includes(kind);
}

/**
 * HOW the platform talks to a partner — which adapter
 * (`src/server/partners/adapter.ts`).
 *
 * `manual` is the only one: a person at the partner does the work, by email
 * or phone or in the Partner Hub, and what they say is recorded. It needs no
 * contract, no key and no legal opinion, which is what makes the seam real
 * before any integration exists. An integrated provider would be a second
 * value here and a second file there, and nothing else would change.
 */
export const PARTNER_PROVIDERS = ["manual"] as const;
export type PartnerProvider = (typeof PARTNER_PROVIDERS)[number];
