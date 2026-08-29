// The contract templates (Phase P5, brief §4 step 4) — what a drafted
// contract actually SAYS, pre-filled from the deal.
//
// A typed module, like `contract-types.ts` and `taxonomy.ts`: the text is
// code-adjacent data that evolves by commit. It becomes rows the day staff
// need to edit a clause without a deploy.
//
// ── Two rules that look like they contradict the house style ──────────────
//
// 1. THE RENDERED TEXT IS STORED, not derived at read time. Everywhere else
//    in this codebase a stored copy of something derivable is a bug waiting
//    to disagree with its source (the five contract filters, the N/M
//    indicator). A contract is the exception, and for the same reason the
//    name snapshots exist: it is a record of what the parties agreed to.
//    Editing this file must never rewrite a contract someone already signed.
//    So `renderContract` runs ONCE, at draft time, and the result is frozen
//    into `contract.content` with the version that produced it.
//
// 2. IT IS RENDERED IN ONE LANGUAGE, not in the reader's. A timeline event
//    re-reads in whatever language you are using, because it is a fact about
//    the past. A contract is an instrument: what was signed is what was
//    signed, and showing a French signatory an English translation of their
//    own obligations would be a different document.
//
// The text below is a PRE-FILL, not lawyer-reviewed boilerplate, and the
// fiche says so on any contract still in `draft`. Its job is to carry the
// commercial terms that were actually agreed — the ones in the accepted
// quote — into a document a human then edits, rather than to be authoritative.

import type { ContractContent, ContractSection, ContractType } from "@/database/schema";
import { formatInstant } from "@/lib/instant";

/** Bump when a template's WORDING changes, so a contract can always be traced
 *  to the text that produced it. Contracts drafted under an older version
 *  keep their content untouched — that is the whole point of freezing it. */
export const CONTRACT_TEMPLATE_VERSION = 1;

export type TemplateLocale = "fr" | "en";

/** Everything a template may interpolate. Assembled by the caller from the
 *  deal, the accepted quote and the workspace — never fetched here, so this
 *  module stays pure and testable. */
export type TemplateFacts = {
  number: string;
  /** ISO date of drafting, rendered in the contract's own locale. */
  date: Date;
  buyerName: string;
  osiName: string;
  supplierName: string;
  dealTitle: string;
  amountCents: number | null;
  currency: string | null;
  incoterm: string | null;
  paymentTerms: string | null;
  leadTimeDays: number | null;
  quantity: string | null;
  moq: string | null;
};

const OSI_LEGAL_NAME = "Oversea Sourcing Intelligence";

/** A term the buyer and supplier agreed but nobody recorded reads as an
 *  explicit blank, never as a plausible default. A contract that invents a
 *  payment term is worse than one that shows a line to fill in. */
function orBlank(value: string | null | undefined, locale: TemplateLocale): string {
  if (value === null || value === undefined || value.trim() === "") {
    return locale === "fr" ? "[à compléter]" : "[to be completed]";
  }
  return value;
}

function formatMoney(
  amountCents: number | null,
  currency: string | null,
  locale: TemplateLocale,
): string {
  if (amountCents === null) return orBlank(null, locale);
  const value = amountCents / 100;
  const tag = locale === "fr" ? "fr-CA" : "en-CA";
  return currency
    ? new Intl.NumberFormat(tag, { style: "currency", currency }).format(value)
    : new Intl.NumberFormat(tag).format(value);
}

function formatDate(date: Date, locale: TemplateLocale): string {
  // Pinned like every other instant in the app (src/lib/instant.ts): a
  // contract drafted at 21:00 in Montréal must not be dated the next day
  // because the container thinks in UTC.
  return formatInstant(date, locale === "fr" ? "fr-CA" : "en-CA", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatLeadTime(days: number | null, locale: TemplateLocale): string {
  if (days === null) return orBlank(null, locale);
  return locale === "fr" ? `${days} jours` : `${days} days`;
}

// ── The templates ───────────────────────────────────────────────────────────
// Each returns the sections of one contract, in one language. Adding the five
// deferred types (transporteur, courtier, inspection, NDA, annexes) means
// adding a branch here and a spec in `contract-types.ts` — no caller changes.

function mandateSections(facts: TemplateFacts, locale: TemplateLocale): ContractSection[] {
  const money = formatMoney(facts.amountCents, facts.currency, locale);
  if (locale === "fr") {
    return [
      {
        heading: "1. Parties",
        body: `Le présent mandat est conclu entre ${facts.buyerName} (« le Client ») et ${OSI_LEGAL_NAME} (« OSI »), en date du ${formatDate(facts.date, locale)}.`,
      },
      {
        heading: "2. Objet du mandat",
        body: `Le Client mandate OSI pour faciliter l'approvisionnement décrit sous « ${facts.dealTitle} » : identification et vérification des fournisseurs, sollicitation et comparaison des soumissions, coordination de la transaction et suivi jusqu'à la livraison.`,
      },
      {
        heading: "3. Rôle et limites",
        body: `OSI agit comme facilitateur. OSI n'est ni le vendeur ni le fabricant des biens visés, ne prend pas possession de la marchandise et ne détient aucun fonds pour le compte du Client. Le contrat commercial est conclu directement entre le Client et ${facts.supplierName}.`,
      },
      {
        heading: "4. Transaction visée",
        body: `Fournisseur retenu : ${facts.supplierName}. Valeur de la transaction : ${money}. Incoterm : ${orBlank(facts.incoterm, locale)}.`,
      },
      {
        heading: "5. Obligations du Client",
        body: `Le Client fournit les spécifications techniques, valide les soumissions, et informe OSI sans délai de tout échange direct avec le fournisseur susceptible de modifier les termes convenus.`,
      },
      {
        heading: "6. Confidentialité",
        body: `Chaque partie protège les informations commerciales et techniques reçues de l'autre et ne les divulgue qu'aux personnes ayant besoin d'en connaître aux fins du présent mandat.`,
      },
      {
        heading: "7. Durée",
        body: `Le mandat prend effet à sa signature par les deux parties et prend fin à la clôture du dossier de transaction ${facts.number}, sauf résiliation antérieure convenue par écrit.`,
      },
    ];
  }
  return [
    {
      heading: "1. Parties",
      body: `This mandate is entered into between ${facts.buyerName} ("the Client") and ${OSI_LEGAL_NAME} ("OSI"), dated ${formatDate(facts.date, locale)}.`,
    },
    {
      heading: "2. Purpose",
      body: `The Client mandates OSI to facilitate the sourcing described as "${facts.dealTitle}": identifying and verifying suppliers, soliciting and comparing quotations, coordinating the transaction and following it through to delivery.`,
    },
    {
      heading: "3. Role and limits",
      body: `OSI acts as a facilitator. OSI is neither the seller nor the manufacturer of the goods concerned, takes no possession of the goods, and holds no funds on the Client's behalf. The commercial contract is concluded directly between the Client and ${facts.supplierName}.`,
    },
    {
      heading: "4. Transaction covered",
      body: `Selected supplier: ${facts.supplierName}. Transaction value: ${money}. Incoterm: ${orBlank(facts.incoterm, locale)}.`,
    },
    {
      heading: "5. Client obligations",
      body: `The Client provides technical specifications, validates quotations, and informs OSI without delay of any direct exchange with the supplier that may alter the agreed terms.`,
    },
    {
      heading: "6. Confidentiality",
      body: `Each party protects the commercial and technical information received from the other and discloses it only to those who need to know it for the purposes of this mandate.`,
    },
    {
      heading: "7. Term",
      body: `The mandate takes effect upon signature by both parties and ends at the closure of transaction file ${facts.number}, unless terminated earlier by written agreement.`,
    },
  ];
}

function purchaseOrderSections(facts: TemplateFacts, locale: TemplateLocale): ContractSection[] {
  const money = formatMoney(facts.amountCents, facts.currency, locale);
  if (locale === "fr") {
    return [
      {
        heading: "1. Parties",
        body: `La présente commande est conclue entre ${facts.buyerName} (« l'Acheteur ») et ${facts.supplierName} (« le Fournisseur »), en date du ${formatDate(facts.date, locale)}. ${OSI_LEGAL_NAME} intervient comme facilitateur et n'est pas partie à la vente.`,
      },
      {
        heading: "2. Marchandise",
        body: `Objet : ${facts.dealTitle}. Quantité : ${orBlank(facts.quantity, locale)}. Quantité minimale de commande : ${orBlank(facts.moq, locale)}. Les spécifications techniques annexées à la demande font partie intégrante de la présente commande.`,
      },
      {
        heading: "3. Prix",
        body: `Prix total convenu : ${money}, selon la soumission acceptée par l'Acheteur. Ce prix est ferme, sauf modification écrite acceptée par les deux parties.`,
      },
      {
        heading: "4. Livraison",
        body: `Incoterm : ${orBlank(facts.incoterm, locale)}. Délai de livraison : ${formatLeadTime(facts.leadTimeDays, locale)} à compter de la confirmation de commande.`,
      },
      {
        heading: "5. Conditions de paiement",
        body: `${orBlank(facts.paymentTerms, locale)}. Les paiements sont effectués directement entre l'Acheteur et le Fournisseur ; OSI ne détient ni ne transfère aucun fonds.`,
      },
      {
        heading: "6. Conformité et inspection",
        body: `Le Fournisseur garantit que la marchandise est conforme aux spécifications convenues. L'Acheteur dispose d'un délai raisonnable après réception pour signaler toute non-conformité.`,
      },
      {
        heading: "7. Documents",
        body: `Le Fournisseur fournit les documents d'expédition et de conformité applicables (facture commerciale, liste de colisage, document de transport, certificats requis).`,
      },
    ];
  }
  return [
    {
      heading: "1. Parties",
      body: `This purchase order is entered into between ${facts.buyerName} ("the Buyer") and ${facts.supplierName} ("the Supplier"), dated ${formatDate(facts.date, locale)}. ${OSI_LEGAL_NAME} acts as facilitator and is not a party to the sale.`,
    },
    {
      heading: "2. Goods",
      body: `Subject: ${facts.dealTitle}. Quantity: ${orBlank(facts.quantity, locale)}. Minimum order quantity: ${orBlank(facts.moq, locale)}. The technical specifications attached to the request form an integral part of this order.`,
    },
    {
      heading: "3. Price",
      body: `Total agreed price: ${money}, per the quotation accepted by the Buyer. This price is firm unless amended in writing by both parties.`,
    },
    {
      heading: "4. Delivery",
      body: `Incoterm: ${orBlank(facts.incoterm, locale)}. Lead time: ${formatLeadTime(facts.leadTimeDays, locale)} from order confirmation.`,
    },
    {
      heading: "5. Payment terms",
      body: `${orBlank(facts.paymentTerms, locale)}. Payments are made directly between the Buyer and the Supplier; OSI neither holds nor transfers any funds.`,
    },
    {
      heading: "6. Conformity and inspection",
      body: `The Supplier warrants that the goods conform to the agreed specifications. The Buyer has a reasonable period after receipt to report any non-conformity.`,
    },
    {
      heading: "7. Documents",
      body: `The Supplier provides the applicable shipping and compliance documents (commercial invoice, packing list, transport document, required certificates).`,
    },
  ];
}

/** The document title, in the contract's own language. Distinct from the
 *  `contrats.type.*` i18n key, which labels the type in the READER's
 *  language — these two are allowed to differ, and on a bilingual screen
 *  they will. */
function documentTitle(type: ContractType, locale: TemplateLocale): string {
  if (type === "mandate_osi_client") {
    return locale === "fr" ? "Mandat de facilitation" : "Facilitation mandate";
  }
  return locale === "fr" ? "Bon de commande" : "Purchase order";
}

/**
 * Render one contract's text. Pure: same facts in, same document out — which
 * is what makes it testable and what lets the result be frozen with
 * confidence.
 */
export function renderContract(
  type: ContractType,
  locale: TemplateLocale,
  facts: TemplateFacts,
): ContractContent {
  const sections =
    type === "mandate_osi_client"
      ? mandateSections(facts, locale)
      : purchaseOrderSections(facts, locale);
  return {
    version: CONTRACT_TEMPLATE_VERSION,
    locale,
    title: documentTitle(type, locale),
    sections,
  };
}

/** True when the stored text predates the current template wording. The fiche
 *  uses it to offer staff a re-draft — and only ever on a `draft` contract,
 *  because re-rendering something already sent or signed would rewrite what
 *  the parties saw. */
export function isStaleContent(content: ContractContent | null): boolean {
  return content !== null && content.version < CONTRACT_TEMPLATE_VERSION;
}
