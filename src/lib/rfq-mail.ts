// The RFQ email — what a supplier is actually sent (Phase V · V06).
//
// Pure and client-safe: the page renders the same text as a preview before
// staff send, so what they approve is byte for byte what leaves.
//
// ── What is in it, and what is deliberately not ─────────────────────────────
//
// The need, the criteria, the deadline, and how to answer. NOT the buyer: the
// builder is never handed the workspace's name, so it cannot print it — the
// supplier learns who the customer is when a dossier opens, not before
// (decision D6). The one place identity can still leak is the buyer's own
// free-text description, which is why staff read the preview before sending.
//
// Until the supplier portal exists (slice 2) the answer comes back by email,
// so the message asks for the figures in the order the offer form takes them.

import type { ContactLocale } from "@/database/schema";

export type RfqCriterion = {
  label: string;
  value: string;
  /** English form of the value, when the translation pass produced one. */
  valueEn: string | null;
  unit: string | null;
};

export type RfqMailInput = {
  locale: ContactLocale;
  requestId: string;
  title: string;
  description: string;
  criteria: RfqCriterion[];
  /** The round's deadline — one instant, shared by every supplier in it. */
  closesAt: Date;
  /** The person, when known; the company name otherwise. */
  greetingName: string | null;
};

export type RfqMail = { subject: string; text: string; html: string };

/** "17 Nov 2026, 16:00 UTC". Always UTC: the reader may be anywhere, and a
 *  deadline quoted in OSI's own time zone is a deadline misread by half the
 *  suppliers it is sent to. */
export function formatDeadline(at: Date, locale: ContactLocale): string {
  const day = new Intl.DateTimeFormat(locale === "fr" ? "fr-CA" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(at);
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  }).format(at);
  return locale === "fr" ? `${day} à ${time} UTC` : `${day}, ${time} UTC`;
}

const COPY = {
  en: {
    subject: (id: string, title: string) => `Request for quotation ${id} — ${title}`,
    hello: (name: string | null) => (name ? `Hello ${name},` : "Hello,"),
    intro:
      "OSI (Oversea Sourcing Intelligence) is sourcing the following on behalf of a client, and your company matches what they are looking for. We would like to invite you to quote.",
    need: "What is needed",
    criteria: "Specifications",
    original: "The client's own description (as written):",
    deadlineTitle: "Deadline",
    deadline: (when: string) => `Please send your offer by ${when}.`,
    howTitle: "How to answer",
    how: "Reply to this email with:",
    fields: [
      "Unit price and currency",
      "Quantity quoted and minimum order quantity (MOQ)",
      "Lead time, in days",
      "Incoterm",
      "Payment terms",
      "How long your offer stays valid",
    ],
    attach: "You may attach a formal quotation (PDF).",
    decline:
      "If this is not something you can supply, a one-line reply saying so is appreciated — it helps us send you better-matched requests.",
    reference: (id: string) => `Reference: ${id} — please keep it in your reply.`,
    sign: "The OSI sourcing team",
    withdrawnSubject: (id: string, title: string) =>
      `Request for quotation ${id} withdrawn — ${title}`,
    withdrawn:
      "Our client has withdrawn the request below, so the request for quotation we sent you is closed.",
    withdrawnSilent: "Please do not prepare or send an offer for it.",
    withdrawnAnswered:
      "Thank you for the offer you sent. It will not be taken further — for a reason that has nothing to do with the offer itself.",
    withdrawnNeed: "The request",
    withdrawnReference: (id: string) => `Reference: ${id}`,
  },
  fr: {
    subject: (id: string, title: string) => `Appel d'offres ${id} — ${title}`,
    hello: (name: string | null) => (name ? `Bonjour ${name},` : "Bonjour,"),
    intro:
      "OSI (Oversea Sourcing Intelligence) recherche le produit ci-dessous pour le compte d'un client, et votre entreprise correspond à ce qu'il recherche. Nous vous invitons à soumettre une offre.",
    need: "Le besoin",
    criteria: "Spécifications",
    original: "La description du client (telle qu'il l'a rédigée) :",
    deadlineTitle: "Date limite",
    deadline: (when: string) => `Merci de nous transmettre votre offre au plus tard le ${when}.`,
    howTitle: "Comment répondre",
    how: "Répondez à ce courriel en indiquant :",
    fields: [
      "Prix unitaire et devise",
      "Quantité offerte et quantité minimale de commande (MOQ)",
      "Délai de livraison, en jours",
      "Incoterm",
      "Conditions de paiement",
      "Durée de validité de votre offre",
    ],
    attach: "Vous pouvez joindre une soumission formelle (PDF).",
    decline:
      "Si ce produit n'entre pas dans votre offre, une réponse d'une ligne nous l'indiquant est appréciée : elle nous aide à mieux cibler nos prochaines demandes.",
    reference: (id: string) => `Référence : ${id} — merci de la conserver dans votre réponse.`,
    sign: "L'équipe d'approvisionnement OSI",
    withdrawnSubject: (id: string, title: string) => `Appel d'offres ${id} retiré — ${title}`,
    withdrawn:
      "Notre client a retiré la demande ci-dessous : l'appel d'offres que nous vous avons transmis est donc clos.",
    withdrawnSilent: "Merci de ne pas préparer ni transmettre d'offre pour cette demande.",
    withdrawnAnswered:
      "Merci pour l'offre que vous nous avez transmise. Elle n'aura pas de suite, pour une raison qui ne tient pas à l'offre elle-même.",
    withdrawnNeed: "La demande",
    withdrawnReference: (id: string) => `Référence : ${id}`,
  },
} as const;

function escapeHtml(raw: string): string {
  return raw
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function criterionLine(criterion: RfqCriterion, locale: ContactLocale): string {
  // English reader → the English form of the value when there is one. The
  // label stays as the buyer's dossier has it: it is a short noun, and a
  // wrong machine translation of it would do more harm than the original.
  const value = locale === "en" ? (criterion.valueEn ?? criterion.value) : criterion.value;
  return `${criterion.label}: ${value}${criterion.unit ? ` ${criterion.unit}` : ""}`;
}

type Block = { title?: string; lines: string[]; list?: string[] };

/** One set of blocks, two renderings — so the plain text staff preview and the
 *  HTML a mail client shows can never say different things. */
function render(blocks: Block[]): { text: string; html: string } {
  const text = blocks
    .map((block) =>
      [
        ...(block.title ? [block.title.toUpperCase()] : []),
        ...block.lines,
        ...(block.list ?? []).map((item) => `  - ${item}`),
      ].join("\n"),
    )
    .join("\n\n");

  const html = blocks
    .map((block) =>
      [
        block.title ? `<h3>${escapeHtml(block.title)}</h3>` : "",
        // The description is the buyer's free text — escape it, and keep its
        // line breaks, which is what the plain version shows.
        ...block.lines.map((line) => `<p>${escapeHtml(line).replaceAll("\n", "<br>")}</p>`),
        block.list
          ? `<ul>${block.list.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
          : "",
      ].join(""),
    )
    .join("");
  return { text, html };
}

export function buildRfqMail(input: RfqMailInput): RfqMail {
  const copy = COPY[input.locale];
  const reference = `#${input.requestId}`;
  const deadline = formatDeadline(input.closesAt, input.locale);
  const criteria = input.criteria.map((criterion) => criterionLine(criterion, input.locale));
  const description = input.description.trim();

  const blocks: Block[] = [
    { lines: [copy.hello(input.greetingName), copy.intro] },
    { title: copy.need, lines: [input.title] },
    ...(criteria.length > 0 ? [{ title: copy.criteria, lines: [], list: criteria }] : []),
    ...(description ? [{ lines: [copy.original, description] }] : []),
    { title: copy.deadlineTitle, lines: [copy.deadline(deadline)] },
    { title: copy.howTitle, lines: [copy.how], list: [...copy.fields] },
    { lines: [copy.attach, copy.decline] },
    { lines: [copy.reference(reference), copy.sign] },
  ];

  return { subject: copy.subject(reference, input.title), ...render(blocks) };
}

export type RfqWithdrawnMailInput = {
  locale: ContactLocale;
  requestId: string;
  title: string;
  greetingName: string | null;
  /** They had already sent an offer — thank them rather than tell them not
   *  to bother. */
  answered: boolean;
};

/**
 * "The RFQ we sent you is withdrawn" (V07) — sent when a buyer cancels a
 * request while its round is open.
 *
 * A supplier who was asked to quote and then hears nothing learns that OSI's
 * requests can be ignored. This is the other half of the RFQ: whoever was
 * written to is told when the question no longer stands. It says WHY in one
 * true clause (the client withdrew) and nothing about the client.
 */
export function buildRfqWithdrawnMail(input: RfqWithdrawnMailInput): RfqMail {
  const copy = COPY[input.locale];
  const reference = `#${input.requestId}`;
  const blocks: Block[] = [
    { lines: [copy.hello(input.greetingName), copy.withdrawn] },
    { title: copy.withdrawnNeed, lines: [input.title] },
    { lines: [input.answered ? copy.withdrawnAnswered : copy.withdrawnSilent] },
    { lines: [copy.withdrawnReference(reference), copy.sign] },
  ];
  return { subject: copy.withdrawnSubject(reference, input.title), ...render(blocks) };
}
