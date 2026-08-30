// Mock data for the OSI demo. Display strings are stored as i18n keys and
// translated at render time via `t(...)` — never hardcode user-facing text here.

export type Risque = "Faible" | "Moyen" | "Élevé";

// Presentational config for the dashboard stat cards; values come from
// getDashboardStatsFn (real, per-user — zeros when anonymous).
export type StatCardConfig = {
  /** key into DashboardStats + i18n label under "stats" */
  key: "activeRequests" | "suppliersEvaluated" | "ongoingTransactions";
  /** i18n label key under "stats" */
  labelKey: string;
  /** i18n key under "stats" for the delta note */
  note: string;
  icone: "demandes" | "fournisseurs" | "transactions" | "analyses";
  /** formats as money when true */
  money?: boolean;
};

export const statsConfig: StatCardConfig[] = [
  { key: "activeRequests", labelKey: "activeRequests", note: "thisWeek", icone: "demandes" },
  {
    key: "suppliersEvaluated",
    labelKey: "evaluatedSuppliers",
    note: "thisWeek",
    icone: "fournisseurs",
  },
  {
    key: "ongoingTransactions",
    labelKey: "ongoingTransactions",
    note: "thisWeek",
    icone: "transactions",
  },
];

// NO "Économies" tile (owner, 2026-08-29). It was showing 0 $ because nothing
// in the data model can compute a saving: there is no baseline — no target
// price, no market price, no previous quote for the same need — to compare an
// accepted offer against. The mockup's confident "348 750 $" would have to be
// invented, and a dashboard number nobody can derive is worse than a missing
// one. It comes back the day intake captures a target price (ADR-002 conflict
// #9), and not before.

// Suppliers & matches now live in the database (supplier/match tables) —
// seeded via src/database/seed.ts, produced by the worker for new requests.

export const etapesTransaction = [
  {
    titre: "stepsTransaction.order.title",
    detail: "stepsTransaction.order.detail",
    etat: "termine" as const,
  },
  {
    titre: "stepsTransaction.payment.title",
    detail: "stepsTransaction.payment.detail",
    etat: "termine" as const,
  },
  {
    titre: "stepsTransaction.fabrication.title",
    detail: "stepsTransaction.fabrication.detail",
    etat: "encours" as const,
  },
  {
    titre: "stepsTransaction.inspection.title",
    detail: "stepsTransaction.inspection.detail",
    etat: "attente" as const,
  },
  {
    titre: "stepsTransaction.shipping.title",
    detail: "stepsTransaction.shipping.detail",
    etat: "attente" as const,
  },
  {
    titre: "stepsTransaction.customs.title",
    detail: "stepsTransaction.customs.detail",
    etat: "attente" as const,
  },
  {
    titre: "stepsTransaction.delivery.title",
    detail: "stepsTransaction.delivery.detail",
    etat: "attente" as const,
  },
];

export type KpiData = { key: string; valeur: string; delta: string };

// `kpisAnalyses` REMOVED 2026-08-29 with the Économies tile. It had no
// consumers — four invented figures ("245 680 $", "45 680 $") kept alive only
// by being exported, and the savings one could not be computed even in
// principle. /analyses reads real aggregates from getAnalyticsFn, which
// returns null for spend and savings rather than a number nobody can derive.

// key: i18n key under "regions"
export const repartition = [
  { key: "asia", valeur: 45 },
  { key: "europe", valeur: 30 },
  { key: "northAmerica", valeur: 15 },
  { key: "others", valeur: 10 },
];

// key: i18n key under "categories"
export const categories = [
  { key: "machines", montant: "98 450 $" },
  { key: "components", montant: "65 230 $" },
  { key: "electronics", montant: "45 680 $" },
  { key: "others", montant: "36 320 $" },
];

export const tendance = [
  { mois: "Jan", valeur: 32 },
  { mois: "Fév", valeur: 38 },
  { mois: "Mar", valeur: 35 },
  { mois: "Avr", valeur: 46 },
  { mois: "Mai", valeur: 52 },
  { mois: "Juin", valeur: 61 },
];

// key: i18n key under "values"
export const valeurs = [
  { key: "intelligent" },
  { key: "confiance" },
  { key: "simplicite" },
  { key: "securite" },
  { key: "efficacite" },
];
