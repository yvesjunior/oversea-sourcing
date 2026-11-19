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
  /**
   * This recipient's personal link to the supplier portal (V15): it opens a
   * free account for them and is where they answer. Absent → the email asks
   * for an answer by reply only, as it did before the portal.
   *
   * The link is different for every recipient, so the preview staff read
   * before sending carries `PORTAL_LINK_PLACEHOLDER` in its place — the one
   * part of the email that cannot be byte for byte what leaves.
   */
  portalUrl?: string | null;
};

/** What the preview shows where each recipient's own link will be. */
export const PORTAL_LINK_PLACEHOLDER =
  "[lien personnel du destinataire / recipient's personal link]";

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
    portalTitle: "Answer online",
    portal:
      "Open your free supplier account with the link below and send your offer there. The link is personal to you — please do not forward it.",
    howAlso: "Or reply to this email with:",
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
    closedSubject: (id: string, title: string) => `Request for quotation ${id} closed — ${title}`,
    roundClosedAnswered:
      "The request for quotation below is now closed. Thank you for your offer: it is being reviewed with our client, and we will let you know the outcome.",
    roundClosedSilent:
      "The request for quotation below is now closed, earlier than the deadline we gave you: no offer is expected from you for it any longer.",
    retainedSubject: (id: string, title: string) =>
      `Your offer has been retained — ${id} — ${title}`,
    retained:
      "Good news: our client has retained the offer you sent for the request below. A member of the OSI team will contact you shortly to arrange the next steps.",
    outcomeSubject: (id: string, title: string) =>
      `Outcome of request for quotation ${id} — ${title}`,
    notRetained:
      "Thank you for the offer you sent for the request below. It was not retained this time.",
    closed:
      "Thank you for the offer you sent us for the request below. The request is now closed and no order will follow from it.",
    closedNext:
      "Your details stay on file, and we will come back to you when a request matches what you supply.",
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
    portalTitle: "Répondre en ligne",
    portal:
      "Ouvrez votre compte fournisseur gratuit avec le lien ci-dessous et déposez-y votre offre. Ce lien vous est personnel — merci de ne pas le transférer.",
    howAlso: "Ou répondez à ce courriel en indiquant :",
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
    closedSubject: (id: string, title: string) => `Appel d'offres ${id} clos — ${title}`,
    roundClosedAnswered:
      "L'appel d'offres ci-dessous est maintenant clos. Merci pour votre offre : elle est en cours d'examen avec notre client, et nous vous tiendrons informé de la suite.",
    roundClosedSilent:
      "L'appel d'offres ci-dessous est maintenant clos, avant la date limite que nous vous avions indiquée : plus aucune offre n'est attendue de votre part pour cette demande.",
    retainedSubject: (id: string, title: string) => `Votre offre a été retenue — ${id} — ${title}`,
    retained:
      "Bonne nouvelle : notre client a retenu l'offre que vous nous avez transmise pour la demande ci-dessous. Un membre de l'équipe OSI vous contactera prochainement pour la suite.",
    outcomeSubject: (id: string, title: string) => `Suite de l'appel d'offres ${id} — ${title}`,
    notRetained:
      "Merci pour l'offre que vous nous avez transmise pour la demande ci-dessous. Elle n'a pas été retenue cette fois-ci.",
    closed:
      "Merci pour l'offre que vous nous avez transmise pour la demande ci-dessous. Cette demande est maintenant close et ne donnera pas lieu à une commande.",
    closedNext:
      "Vos coordonnées restent dans nos dossiers : nous reviendrons vers vous lorsqu'une demande correspondra à votre offre.",
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

export type Block = { title?: string; lines: string[]; list?: string[]; url?: string };

/** One set of blocks, two renderings — so the plain text staff preview and the
 *  HTML a mail client shows can never say different things. */
/** Exported for the other mails built the same way (partner-mail.ts, V23). */
export function render(blocks: Block[]): { text: string; html: string } {
  const text = blocks
    .map((block) =>
      [
        ...(block.title ? [block.title.toUpperCase()] : []),
        ...block.lines,
        ...(block.url ? [block.url] : []),
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
        // A real anchor: not every mail client turns a bare URL into a link,
        // and this one is the whole point of the block.
        block.url ? `<p><a href="${escapeHtml(block.url)}">${escapeHtml(block.url)}</a></p>` : "",
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
    // With a portal link the online answer comes first and the reply by
    // email stays as the alternative — both remain, permanently: a supplier
    // who will not open an account still answers, and staff type it in.
    ...(input.portalUrl
      ? [
          { title: copy.portalTitle, lines: [copy.portal], url: input.portalUrl },
          { lines: [copy.howAlso], list: [...copy.fields] },
        ]
      : [{ title: copy.howTitle, lines: [copy.how], list: [...copy.fields] }]),
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

export type RfqClosedMailInput = {
  locale: ContactLocale;
  requestId: string;
  title: string;
  greetingName: string | null;
};

/**
 * "The request you quoted for is closed" (V11) — sent to the suppliers whose
 * offers are in hand when staff refuse to send a Decision Pack.
 *
 * Not the withdrawal notice: nobody withdrew anything, and the refusal may
 * well be about the offers themselves, so this says neither "the client
 * changed their mind" nor "it has nothing to do with your offer". It says
 * the two things that are true whatever the reason — the request is closed,
 * no order follows — and nothing about why, which is OSI's and the buyer's.
 * Only to suppliers who ANSWERED: one who stayed silent was never owed a
 * follow-up (a silent supplier is excluded, not chased).
 */
export function buildRfqClosedMail(input: RfqClosedMailInput): RfqMail {
  const copy = COPY[input.locale];
  const reference = `#${input.requestId}`;
  const blocks: Block[] = [
    { lines: [copy.hello(input.greetingName), copy.closed] },
    { title: copy.withdrawnNeed, lines: [input.title] },
    { lines: [copy.closedNext] },
    { lines: [copy.withdrawnReference(reference), copy.sign] },
  ];
  return { subject: copy.closedSubject(reference, input.title), ...render(blocks) };
}

export type SupplierNoticeInput = {
  locale: ContactLocale;
  requestId: string;
  title: string;
  greetingName: string | null;
};

/**
 * "The window is closed" (Phase V · V17) — sent when a round closes into the
 * review.
 *
 * To a supplier who ANSWERED: their offer is in and being looked at. To one
 * who had NOT, only when the round closed BEFORE the deadline they were given
 * (staff stopped waiting, or enough offers were in): their email still says
 * a later date, and one who answers after the close would be answering into
 * nothing (decision D13). A supplier who simply let the deadline pass is told
 * nothing — they knew the date, and a silent supplier is not chased.
 *
 * It says the window closed and never why: "enough offers were in" tells a
 * supplier how the others answered.
 */
export function buildRoundClosedMail(input: SupplierNoticeInput & { answered: boolean }): RfqMail {
  const copy = COPY[input.locale];
  const reference = `#${input.requestId}`;
  const blocks: Block[] = [
    {
      lines: [
        copy.hello(input.greetingName),
        input.answered ? copy.roundClosedAnswered : copy.roundClosedSilent,
      ],
    },
    { title: copy.withdrawnNeed, lines: [input.title] },
    ...(input.answered ? [] : [{ lines: [copy.closedNext] }]),
    { lines: [copy.withdrawnReference(reference), copy.sign] },
  ];
  return { subject: copy.closedSubject(reference, input.title), ...render(blocks) };
}

/**
 * The outcome, once the buyer has chosen (V17).
 *
 * `retained`: their offer was accepted, and someone will be in touch.
 * Not retained: that, and NOTHING ELSE — not who was, not at what price, not
 * how many answered, not where they ranked. Each of those is another
 * supplier's business or the buyer's, and the sentence is written so that
 * there is nowhere for one of them to go.
 */
export function buildOutcomeMail(input: SupplierNoticeInput & { retained: boolean }): RfqMail {
  const copy = COPY[input.locale];
  const reference = `#${input.requestId}`;
  const blocks: Block[] = [
    { lines: [copy.hello(input.greetingName), input.retained ? copy.retained : copy.notRetained] },
    { title: copy.withdrawnNeed, lines: [input.title] },
    ...(input.retained ? [] : [{ lines: [copy.closedNext] }]),
    { lines: [copy.withdrawnReference(reference), copy.sign] },
  ];
  return {
    subject: input.retained
      ? copy.retainedSubject(reference, input.title)
      : copy.outcomeSubject(reference, input.title),
    ...render(blocks),
  };
}
