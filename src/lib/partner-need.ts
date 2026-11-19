// What a partner needs to know (Phase V · V23) — the rule, per kind of case.
//
// A partner is the second EXTERNAL audience, and its need-to-know is not a
// supplier's. A supplier sees a request and its own offer. A partner is asked
// one question about one offer — "what does it cost to ship this?" — and is
// shown what answering that question takes, and nothing more.
//
// The rule is a table, written down here rather than scattered in a query:
// each kind of case names the facts it may be shown. Everything else about
// the offer, the request and the buyer is absent from what the Partner Hub
// receives — not hidden by the page, absent from the answer.
//
// NEVER shown to any partner, whatever the kind, because no fact below
// carries it: who the buyer is, any other supplier or offer, a rank or a
// score, OSI's fee, the payment terms, the supplier's notes, another
// partner's figure, the name of the staff member who opened the case.

import type { PartnerKind } from "@/lib/partners";

/** The facts about an offer a case can carry. */
export const CASE_FACTS = [
  /** What the goods are: the request's title and its specification lines.
   *  Not the buyer's free text — it is theirs, and may name them. */
  "goods",
  /** The quantity the supplier offered. */
  "quantity",
  /** The country the goods leave from. */
  "origin",
  /** The incoterm the supplier quoted on, with its named place. */
  "incoterm",
  /** How long the supplier needs before the goods are ready. */
  "lead_time",
  /** The supplier's UNIT price and its currency. The name is older than the
   *  understanding: this was taken for the value of the goods and labelled
   *  so until 2026-11-19. It is what the RFQ asks for — « Prix unitaire et
   *  devise » — so the value of a shipment is this figure applied to
   *  `quantity`, which is free text. A case that carries this fact carries
   *  `quantity` beside it for that reason; the label says « Prix unitaire du
   *  fournisseur », never a value. */
  "goods_value",
  /** Who the supplier is. */
  "supplier_identity",
] as const;
export type CaseFact = (typeof CASE_FACTS)[number];

/**
 * What each kind of case is shown, and why.
 *
 * The price is the sensitive one. It is in a case only where the answer is
 * computed FROM it: an insurer prices a premium on the insured value, a
 * customs broker applies a rate to the customs value. A freight forwarder
 * prices weight, volume and route; an inspector prices a day of work.
 */
export const CASE_NEEDS: Record<PartnerKind, readonly CaseFact[]> = {
  // What moves, how much of it, from where, on which term, ready when.
  transport: ["goods", "quantity", "origin", "incoterm", "lead_time"],
  // The premium is a rate on the value insured, over a route.
  insurance: ["goods", "quantity", "origin", "incoterm", "goods_value"],
  // Duties and taxes are rates on the customs value, by origin.
  customs: ["goods", "quantity", "origin", "incoterm", "goods_value"],
  // An inspector goes to the factory: they must know whose. Not at what
  // price the factory sells.
  inspection: ["goods", "quantity", "origin", "supplier_identity"],
  // The money circuit is not open (legal gate); a settlement case would be
  // specified with it.
  settlement: [],
};

export function caseNeeds(kind: PartnerKind, fact: CaseFact): boolean {
  return CASE_NEEDS[kind].includes(fact);
}

/** Everything that COULD be said about the offer a case is about. */
export type CaseFacts = {
  goods: { title: string; lines: string[] };
  quantity: string | null;
  origin: string | null;
  incoterm: string | null;
  lead_time: number | null;
  goods_value: { amountCents: number; currency: string } | null;
  supplier_identity: string | null;
};

/**
 * What this kind of case is shown — the facts it needs, the rest REMOVED.
 *
 * The server builds the whole set and passes it through here before anything
 * leaves; a key a kind does not need is not in the result at all, so a page
 * cannot show by mistake what it was never sent.
 */
export function factsForCase(kind: PartnerKind, facts: CaseFacts): Partial<CaseFacts> {
  const shown: Partial<CaseFacts> = {};
  for (const fact of CASE_NEEDS[kind]) {
    // One assignment per key keeps each fact's own type.
    if (fact === "goods") shown.goods = facts.goods;
    else if (fact === "quantity") shown.quantity = facts.quantity;
    else if (fact === "origin") shown.origin = facts.origin;
    else if (fact === "incoterm") shown.incoterm = facts.incoterm;
    else if (fact === "lead_time") shown.lead_time = facts.lead_time;
    else if (fact === "goods_value") shown.goods_value = facts.goods_value;
    else shown.supplier_identity = facts.supplier_identity;
  }
  return shown;
}

/** May a partner still answer this case? Not once staff withdrew it. */
export function canAnswerCase(status: "open" | "answered" | "cancelled"): boolean {
  return status !== "cancelled";
}
