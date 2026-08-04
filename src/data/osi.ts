// Mock data for the OSI demo. Display strings are stored as i18n keys and
// translated at render time via `t(...)` — never hardcode user-facing text here.

export type Statut =
  "En analyse" | "Validation fournisseur" | "Rapport prêt" | "Recherche terminée";
export type Risque = "Faible" | "Moyen" | "Élevé";

export type Dossier = {
  id: string;
  statut: Statut;
  compatibilite: number;
  /** i18n key, e.g. "time.min15" */
  maj: string;
};

// Presentational config for the dashboard stat cards; values come from
// getDashboardStatsFn (real, per-user — zeros when anonymous).
export type StatCardConfig = {
  /** key into DashboardStats + i18n label under "stats" */
  key: "activeRequests" | "suppliersEvaluated" | "ongoingTransactions" | "savingsGenerated";
  /** i18n label key under "stats" */
  labelKey: string;
  /** i18n key under "stats" for the delta note */
  note: string;
  icone: "demandes" | "fournisseurs" | "transactions" | "economies" | "analyses";
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
  {
    key: "savingsGenerated",
    labelKey: "savings",
    note: "thisMonth",
    icone: "economies",
    money: true,
  },
];

export const dossiers: Dossier[] = [
  { id: "2541", statut: "En analyse", compatibilite: 91, maj: "time.min15" },
  { id: "2540", statut: "Validation fournisseur", compatibilite: 87, maj: "time.h1" },
  { id: "2539", statut: "Rapport prêt", compatibilite: 95, maj: "time.h3" },
  { id: "2538", statut: "Recherche terminée", compatibilite: 88, maj: "time.h5" },
  { id: "2537", statut: "Rapport prêt", compatibilite: 84, maj: "time.yesterday" },
  { id: "2536", statut: "En analyse", compatibilite: 79, maj: "time.yesterday" },
];

export const etapesDemande = [
  {
    titre: "stepsDemande.received.title",
    detail: "stepsDemande.received.detail",
    etat: "termine" as const,
  },
  {
    titre: "stepsDemande.analysis.title",
    detail: "stepsDemande.analysis.detail",
    etat: "encours" as const,
  },
  {
    titre: "stepsDemande.search.title",
    detail: "stepsDemande.search.detail",
    etat: "attente" as const,
  },
  {
    titre: "stepsDemande.validation.title",
    detail: "stepsDemande.validation.detail",
    etat: "attente" as const,
  },
  {
    titre: "stepsDemande.report.title",
    detail: "stepsDemande.report.detail",
    etat: "attente" as const,
  },
];

// i18n keys under "criteria"
export const criteres = [
  "criteria.material",
  "criteria.flow",
  "criteria.pressure",
  "criteria.certifications",
  "criteria.quantity",
  "criteria.delivery",
];

export type Fournisseur = {
  rang: number;
  /** brand name — not translated */
  nom: string;
  /** brand descriptor — not translated */
  sousTitre: string;
  /** ISO code, also the i18n key under "countries" */
  code: string;
  compatibilite: number;
  confiance: number;
  risque: Risque;
};

export const fournisseurs: Fournisseur[] = [
  {
    rang: 1,
    nom: "AQUATEK",
    sousTitre: "Solutions",
    code: "DE",
    compatibilite: 97,
    confiance: 96,
    risque: "Faible",
  },
  {
    rang: 2,
    nom: "NORDIC",
    sousTitre: "Pumps",
    code: "SE",
    compatibilite: 94,
    confiance: 92,
    risque: "Faible",
  },
  {
    rang: 3,
    nom: "FlowMax",
    sousTitre: "Industries",
    code: "US",
    compatibilite: 92,
    confiance: 90,
    risque: "Faible",
  },
  {
    rang: 4,
    nom: "SINOFLUID",
    sousTitre: "Equipment",
    code: "CN",
    compatibilite: 89,
    confiance: 88,
    risque: "Moyen",
  },
  {
    rang: 5,
    nom: "ITALPOMPE",
    sousTitre: "Group",
    code: "IT",
    compatibilite: 87,
    confiance: 88,
    risque: "Faible",
  },
];

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

export const kpisAnalyses: KpiData[] = [
  { key: "totalSpend", valeur: "245 680 $", delta: "+12%" },
  { key: "savings", valeur: "45 680 $", delta: "+18%" },
  { key: "transactions", valeur: "23", delta: "+9%" },
  { key: "activeSuppliers", valeur: "156", delta: "+15%" },
];

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
