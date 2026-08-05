/**
 * Dev seed — demo accounts for local development. Idempotent.
 * Run inside the dev stack:  docker compose -f docker-compose.dev.yml exec web npm run db:seed
 *
 * Accounts (password for all: `osi-demo-1234`):
 *   owner@osi.dev       platform employee — owner (full control)
 *   manager@osi.dev     platform employee — manager (ops)
 *   accountant@osi.dev  platform employee — accountant (finance)
 *   buyer@osi.dev       regular buyer (own personal workspace)
 */
import { eq } from "drizzle-orm";
import { db } from "./index";
import * as schema from "./schema";
import { auth } from "../server/auth";

const PASSWORD = "osi-demo-1234";

// Named after their role on purpose — the dashboard greeting instantly tells
// you which account you are testing with ("Bonjour Manager,").
const comptes = [
  { email: "owner@osi.dev", name: "Owner", platformRole: "owner" },
  { email: "manager@osi.dev", name: "Manager", platformRole: "manager" },
  { email: "accountant@osi.dev", name: "Accountant", platformRole: "accountant" },
  { email: "buyer@osi.dev", name: "Buyer", platformRole: "user" },
] as const;

async function main() {
  for (const compte of comptes) {
    const existing = await db.query.user.findFirst({
      where: eq(schema.user.email, compte.email),
    });
    if (existing) {
      // Converge existing accounts to the desired name/role (idempotent upsert).
      await db
        .update(schema.user)
        .set({ name: compte.name, platformRole: compte.platformRole })
        .where(eq(schema.user.email, compte.email));
      console.log(`~ updated: ${compte.email} (${compte.name}, ${compte.platformRole})`);
      continue;
    }
    // Sign up through better-auth so password hashing and the personal
    // workspace hook behave exactly like production signups.
    await auth.api.signUpEmail({
      body: { email: compte.email, password: PASSWORD, name: compte.name, locale: "fr" },
    });
    if (compte.platformRole !== "user") {
      await db
        .update(schema.user)
        .set({ platformRole: compte.platformRole })
        .where(eq(schema.user.email, compte.email));
    }
    console.log(`+ created: ${compte.email} (${compte.platformRole})`);
  }
  await seedSuppliers();
  await seedRequests();
  console.log("Seed done. Password for all accounts: " + PASSWORD);
  process.exit(0);
}

// ── Supplier pool (platform-global) ──────────────────────────────────────────
// Stands in for the E4 import pipeline: this is DB ingestion, not app data —
// every page reads suppliers/matches from Postgres.
const SUPPLIERS_DEMO = [
  {
    id: "sup-aquatek",
    name: "AQUATEK",
    descriptor: "Solutions",
    countryCode: "DE",
    provenance: "osi_verified",
    verificationStatus: "verified",
    confidenceScore: 96,
    riskLevel: "low",
  },
  {
    id: "sup-nordic",
    name: "NORDIC",
    descriptor: "Pumps",
    countryCode: "SE",
    provenance: "osi_verified",
    verificationStatus: "verified",
    confidenceScore: 92,
    riskLevel: "low",
  },
  {
    id: "sup-flowmax",
    name: "FlowMax",
    descriptor: "Industries",
    countryCode: "US",
    provenance: "imported",
    verificationStatus: "verified",
    confidenceScore: 90,
    riskLevel: "low",
  },
  {
    id: "sup-sinofluid",
    name: "SINOFLUID",
    descriptor: "Equipment",
    countryCode: "CN",
    provenance: "imported",
    verificationStatus: "pending",
    confidenceScore: 88,
    riskLevel: "medium",
  },
  {
    id: "sup-italpompe",
    name: "ITALPOMPE",
    descriptor: "Group",
    countryCode: "IT",
    provenance: "imported",
    verificationStatus: "verified",
    confidenceScore: 88,
    riskLevel: "low",
  },
  {
    id: "sup-rheinstahl",
    name: "RheinStahl",
    descriptor: "Werke",
    countryCode: "DE",
    provenance: "imported",
    verificationStatus: "verified",
    confidenceScore: 85,
    riskLevel: "low",
  },
  {
    id: "sup-mecaprecis",
    name: "MécaPrécis",
    descriptor: "Usinage",
    countryCode: "FR",
    provenance: "osi_verified",
    verificationStatus: "verified",
    confidenceScore: 84,
    riskLevel: "low",
  },
  {
    id: "sup-iberflow",
    name: "IberFlow",
    descriptor: "Sistemas",
    countryCode: "ES",
    provenance: "imported",
    verificationStatus: "pending",
    confidenceScore: 78,
    riskLevel: "medium",
  },
  {
    id: "sup-nippon-seiko",
    name: "Nippon Seiko",
    descriptor: "Bearings",
    countryCode: "JP",
    provenance: "imported",
    verificationStatus: "verified",
    confidenceScore: 91,
    riskLevel: "low",
  },
  {
    id: "sup-shenzhen-elec",
    name: "Shenzhen Electro",
    descriptor: "Components",
    countryCode: "CN",
    provenance: "ai_researched",
    verificationStatus: "unverified",
    confidenceScore: 66,
    riskLevel: "medium",
  },
  {
    id: "sup-baltic-tex",
    name: "BalticTex",
    descriptor: "Technical Fabrics",
    countryCode: "SE",
    provenance: "ai_researched",
    verificationStatus: "unverified",
    confidenceScore: 61,
    riskLevel: "medium",
  },
  {
    id: "sup-usa-packaging",
    name: "AmeriPack",
    descriptor: "Food Grade",
    countryCode: "US",
    provenance: "imported",
    verificationStatus: "pending",
    confidenceScore: 74,
    riskLevel: "low",
  },
] as const;

async function seedSuppliers() {
  for (const s of SUPPLIERS_DEMO) {
    await db
      .insert(schema.supplier)
      .values(s)
      .onConflictDoUpdate({
        target: schema.supplier.id,
        set: {
          name: s.name,
          descriptor: s.descriptor,
          countryCode: s.countryCode,
          provenance: s.provenance,
          verificationStatus: s.verificationStatus,
          confidenceScore: s.confidenceScore,
          riskLevel: s.riskLevel,
        },
      });
  }
  console.log(`+ seeded ${SUPPLIERS_DEMO.length} suppliers (platform-global pool)`);
}

/** Demo sourcing requests for the buyer account (idempotent upsert by id). */
async function seedRequests() {
  const buyer = await db.query.user.findFirst({
    where: eq(schema.user.email, "buyer@osi.dev"),
  });
  if (!buyer) return;
  const membership = await db.query.member.findFirst({
    where: eq(schema.member.userId, buyer.id),
  });
  if (!membership) return;

  const now = Date.now();
  const MIN = 60_000;
  // No hardcoded scores: the matcher computes them for dossiers whose pipeline
  // reached the matching stage; earlier dossiers legitimately have none yet.
  const demandes = [
    { id: "2541", title: "Pompes industrielles inox", status: "analyzing", age: 15 * MIN },
    { id: "2540", title: "Composants électroniques", status: "validating", age: 60 * MIN },
    { id: "2539", title: "Machines CNC", status: "report_ready", age: 3 * 60 * MIN },
    { id: "2538", title: "Emballage alimentaire", status: "searching", age: 5 * 60 * MIN },
    { id: "2537", title: "Roulements haute charge", status: "report_ready", age: 26 * 60 * MIN },
    { id: "2536", title: "Textiles techniques", status: "analyzing", age: 30 * 60 * MIN },
  ] as const;

  const { createMatchesForRequest } = await import("../server/matching");

  for (const demande of demandes) {
    const updatedAt = new Date(now - demande.age);
    await db
      .insert(schema.request)
      .values({
        id: demande.id,
        organizationId: membership.organizationId,
        createdBy: buyer.id,
        title: demande.title,
        descriptionRaw: demande.title,
        status: demande.status,
        compatibilityScore: null,
        launchedAt: updatedAt,
        createdAt: updatedAt,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: schema.request.id,
        set: {
          title: demande.title,
          status: demande.status,
          compatibilityScore: null,
          updatedAt,
        },
      });
    await seedRequestChildren(demande.id, membership.organizationId, demande.status, updatedAt);

    // Matching stage already ran for these — produce the real match rows the
    // same way the worker does (event is back-dated by seedRequestChildren).
    if (demande.status === "validating" || demande.status === "report_ready") {
      await createMatchesForRequest(demande.id, membership.organizationId, {
        recordEvent: false,
      });
      // The matcher bumps updatedAt to now — restore the demo timestamp.
      await db.update(schema.request).set({ updatedAt }).where(eq(schema.request.id, demande.id));
    }
  }
  console.log(`+ seeded ${demandes.length} demo requests for buyer@osi.dev (matches via matcher)`);
}

// Demo criteria per dossier theme (label, value, unit?, required?).
const CRITERES_DEMO: Record<
  string,
  Array<{ cat: schema.CriteriaCategory; l: string; v: string; u?: string; r?: boolean }>
> = {
  "2541": [
    { cat: "material", l: "Matériau", v: "Acier inoxydable 316", r: true },
    { cat: "flow", l: "Débit", v: "50 à 100", u: "m³/h", r: true },
    { cat: "pressure", l: "Pression", v: "10 à 16", u: "bar" },
    { cat: "certification", l: "Certifications", v: "ISO 9001, CE" },
    { cat: "quantity", l: "Quantité annuelle", v: "500", u: "unités" },
    { cat: "lead_time", l: "Délai de livraison", v: "30 jours max" },
  ],
  "2540": [
    { cat: "other", l: "Type", v: "Microcontrôleurs 32 bits", r: true },
    { cat: "certification", l: "Conformité", v: "RoHS, REACH", r: true },
    { cat: "quantity", l: "Volume mensuel", v: "10 000", u: "pièces" },
    { cat: "lead_time", l: "Délai", v: "6 semaines max" },
  ],
  "2539": [
    { cat: "other", l: "Type de machine", v: "Centre d'usinage 5 axes", r: true },
    { cat: "other", l: "Course X/Y/Z", v: "800 / 600 / 500", u: "mm" },
    { cat: "certification", l: "Certifications", v: "CE, ISO 9001", r: true },
    { cat: "quantity", l: "Quantité", v: "2", u: "machines" },
    { cat: "lead_time", l: "Délai", v: "4 mois max" },
  ],
  "2538": [
    { cat: "material", l: "Matériau", v: "PET recyclable contact alimentaire", r: true },
    { cat: "certification", l: "Certifications", v: "FDA, EU 10/2011", r: true },
    { cat: "quantity", l: "Volume annuel", v: "2 000 000", u: "unités" },
  ],
  "2537": [
    { cat: "material", l: "Matériau", v: "Acier chromé 100Cr6", r: true },
    { cat: "other", l: "Charge dynamique", v: "≥ 120", u: "kN", r: true },
    { cat: "certification", l: "Certification", v: "ISO 492 P5" },
    { cat: "quantity", l: "Quantité annuelle", v: "5 000", u: "unités" },
  ],
  "2536": [
    { cat: "material", l: "Fibre", v: "Aramide haute ténacité", r: true },
    { cat: "other", l: "Grammage", v: "200 à 260", u: "g/m²" },
    { cat: "certification", l: "Norme", v: "EN ISO 11612" },
  ],
};

/** How far the pipeline progressed per status → which status.* events exist. */
const STATUS_TRAIL: Record<string, string[]> = {
  analyzing: ["received", "analyzing"],
  searching: ["received", "analyzing", "searching"],
  validating: ["received", "analyzing", "searching", "validating"],
  report_ready: ["received", "analyzing", "searching", "validating", "report_ready"],
};

/** Criteria, chat and events for a demo request — delete-then-insert with
 *  derived ids keeps the seed deterministic and safe to re-run. */
async function seedRequestChildren(
  requestId: string,
  organizationId: string,
  status: string,
  createdAt: Date,
) {
  await db.delete(schema.requestCriterion).where(eq(schema.requestCriterion.requestId, requestId));
  await db.delete(schema.requestMessage).where(eq(schema.requestMessage.requestId, requestId));
  await db.delete(schema.requestEvent).where(eq(schema.requestEvent.requestId, requestId));
  await db.delete(schema.match).where(eq(schema.match.requestId, requestId));

  const MIN = 60_000;
  const at = (minutes: number) => new Date(createdAt.getTime() + minutes * MIN);

  const criteres = CRITERES_DEMO[requestId] ?? [];
  if (criteres.length > 0) {
    await db.insert(schema.requestCriterion).values(
      criteres.map((critere, index) => ({
        id: `${requestId}-crit-${index}`,
        requestId,
        category: critere.cat,
        label: critere.l,
        value: critere.v,
        unit: critere.u ?? null,
        required: critere.r ?? false,
        source: "ai" as const,
        position: index,
        createdAt: at(2),
      })),
    );
  }

  const trail = STATUS_TRAIL[status] ?? ["received"];
  const events = [
    { type: "request.created", message: null as string | null, minutes: 0 },
    ...trail.map((step, index) => ({
      type: `status.${step}`,
      message: null as string | null,
      minutes: index * 2,
    })),
    {
      type: "criteria.extracted",
      message: JSON.stringify({ count: criteres.length }),
      minutes: 3,
    },
    ...(trail.includes("searching")
      ? [{ type: "search.launched", message: null as string | null, minutes: 4 }]
      : []),
    ...(trail.includes("validating")
      ? [
          {
            type: "matches.created",
            message: JSON.stringify({ count: 5, analyzed: SUPPLIERS_DEMO.length }),
            minutes: 5,
          },
        ]
      : []),
  ].sort((a, b) => a.minutes - b.minutes);
  await db.insert(schema.requestEvent).values(
    events.map((event, index) => ({
      id: `${requestId}-evt-${index}`,
      requestId,
      organizationId,
      type: event.type,
      message: event.message,
      createdAt: at(event.minutes),
    })),
  );

  // A short chat history on the two dossiers the demo opens most often.
  const chats: Record<string, Array<{ role: "user" | "assistant"; content: string }>> = {
    "2541": [
      {
        role: "user",
        content: "Peux-tu ajouter la certification ATEX et une préférence Europe ?",
      },
      {
        role: "assistant",
        content:
          "C'est noté : j'ai ajouté la certification ATEX aux critères. La préférence régionale Europe sera prise en compte lors de la recherche mondiale.",
      },
    ],
    "2539": [
      { role: "user", content: "Le délai de 4 mois est-il réaliste pour du 5 axes ?" },
      {
        role: "assistant",
        content:
          "Oui pour les constructeurs disposant de machines en stock ou en cours d'assemblage. J'ai marqué le délai comme critère afin de filtrer les fabricants sur commande pure.",
      },
    ],
  };
  const messages = chats[requestId] ?? [];
  if (messages.length > 0) {
    await db.insert(schema.requestMessage).values(
      messages.map((message, index) => ({
        id: `${requestId}-msg-${index}`,
        requestId,
        role: message.role,
        content: message.content,
        createdAt: at(5 + index),
      })),
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
