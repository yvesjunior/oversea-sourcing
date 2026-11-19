// What a partner is written (Phase V · V23) — pure.
//
// Two emails, both to a person at a partner:
//
//   the invitation   a staff member opens the Partner Hub to them; the link
//                    creates their account.
//   a new case       a question was put to their partner; the link leads to
//                    it. Sent to the accounts the partner already has.
//
// What neither says: who the buyer is, who the supplier is, any price. An
// email travels further than a page behind a session, so it carries the
// reference and the kind of question — the case itself is read in the Hub,
// where `factsForCase` decides what is shown.

import type { ContactLocale } from "@/database/schema";
import type { PartnerKind } from "@/lib/partners";
import { render, type Block, type RfqMail } from "@/lib/rfq-mail";

const KIND: Record<ContactLocale, Record<PartnerKind, string>> = {
  en: {
    transport: "transport",
    inspection: "inspection",
    customs: "customs",
    insurance: "insurance",
    settlement: "settlement",
  },
  fr: {
    transport: "transport",
    inspection: "inspection",
    customs: "douane",
    insurance: "assurance",
    settlement: "règlement",
  },
};

const COPY = {
  en: {
    hello: (name: string | null) => (name ? `Hello ${name},` : "Hello,"),
    inviteSubject: (partner: string) => `Your access to the OSI Partner Hub — ${partner}`,
    inviteIntro: (partner: string) =>
      `OSI works with ${partner} and would like to send you its requests through the Partner Hub: you see the cases addressed to ${partner} and answer them there.`,
    inviteLinkTitle: "Create your account",
    inviteLink:
      "The account is free. This link is personal and valid for thirty days — it creates an account for this address:",
    caseSubject: (reference: string, kind: string) => `New ${kind} case ${reference} — OSI`,
    caseIntro: (kind: string) =>
      `OSI has a ${kind} question for you. The details and the form to answer are in the Partner Hub.`,
    caseLinkTitle: "Open the case",
    reference: (reference: string) => `OSI reference: ${reference}`,
    sign: "The OSI sourcing team",
  },
  fr: {
    hello: (name: string | null) => (name ? `Bonjour ${name},` : "Bonjour,"),
    inviteSubject: (partner: string) => `Votre accès au Partner Hub d’OSI — ${partner}`,
    inviteIntro: (partner: string) =>
      `OSI travaille avec ${partner} et souhaite vous adresser ses demandes par le Partner Hub : vous y voyez les dossiers adressés à ${partner} et vous y répondez.`,
    inviteLinkTitle: "Créer votre compte",
    inviteLink:
      "Le compte est gratuit. Ce lien est personnel et valable trente jours — il crée un compte pour cette adresse :",
    caseSubject: (reference: string, kind: string) => `Nouveau dossier ${kind} ${reference} — OSI`,
    caseIntro: (kind: string) =>
      `OSI a une question de ${kind} pour vous. Le détail et le formulaire de réponse sont dans le Partner Hub.`,
    caseLinkTitle: "Ouvrir le dossier",
    reference: (reference: string) => `Référence OSI : ${reference}`,
    sign: "L’équipe d’approvisionnement OSI",
  },
} as const;

export type PartnerInvitationMailInput = {
  locale: ContactLocale;
  partnerName: string;
  greetingName: string | null;
  /** The registration link — the token is in it and nowhere else. */
  url: string;
};

export function buildPartnerInvitationMail(input: PartnerInvitationMailInput): RfqMail {
  const copy = COPY[input.locale];
  const blocks: Block[] = [
    { lines: [copy.hello(input.greetingName), copy.inviteIntro(input.partnerName)] },
    { title: copy.inviteLinkTitle, lines: [copy.inviteLink], url: input.url },
    { lines: [copy.sign] },
  ];
  return { subject: copy.inviteSubject(input.partnerName), ...render(blocks) };
}

export type CaseOpenedMailInput = {
  locale: ContactLocale;
  greetingName: string | null;
  /** OSI's reference for the dossier — "#3049". */
  reference: string;
  kind: PartnerKind;
  /** The case's page in the Hub. Behind a session: the link alone shows
   *  nothing. */
  url: string;
};

export function buildCaseOpenedMail(input: CaseOpenedMailInput): RfqMail {
  const copy = COPY[input.locale];
  const kind = KIND[input.locale][input.kind];
  const blocks: Block[] = [
    { lines: [copy.hello(input.greetingName), copy.caseIntro(kind)] },
    { title: copy.caseLinkTitle, lines: [], url: input.url },
    { lines: [copy.reference(input.reference), copy.sign] },
  ];
  return { subject: copy.caseSubject(input.reference, kind), ...render(blocks) };
}
