import { createFileRoute, Link } from "@tanstack/react-router";
import { BadgeCheck, ScanSearch } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { CountryTag } from "@/components/osi/CountryTag";
import { RiskBadge } from "@/components/osi/RiskBadge";
import { EmployeeTabs, MineEmpty } from "@/components/osi/EmployeeTabs";
import type { Risque } from "@/data/osi";
import type { RiskLevel } from "@/database/schema";
import { canSeeAllRequests } from "@/lib/roles";
import { getMyMatchedSuppliersFn, getSuppliersFn, type SupplierView } from "@/lib/supplier-fns";

const RISK_LABEL: Record<RiskLevel, Risque> = {
  low: "Faible",
  medium: "Moyen",
  high: "Élevé",
};

export const Route = createFileRoute("/fournisseurs")({
  head: () => ({
    meta: [
      { title: "Fournisseurs vérifiés et évalués | OSI" },
      {
        name: "description",
        content:
          "Explorez les fournisseurs industriels évalués par OSI : compatibilité, score de confiance et risque.",
      },
      { property: "og:title", content: "Fournisseurs vérifiés | OSI" },
      {
        property: "og:description",
        content: "Compatibilité, confiance et niveau de risque pour chaque fournisseur.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  // Real supplier directory (platform-global dataset) + the caller's own
  // shortlisted suppliers for the employee "Mes données" tab.
  loader: async () => {
    const [directory, mine] = await Promise.all([getSuppliersFn(), getMyMatchedSuppliersFn()]);
    return { directory, mine };
  },
  component: Fournisseurs,
});

function SupplierGrid({ suppliers }: { suppliers: SupplierView[] }) {
  const { t } = useTranslation();
  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {suppliers.map((s) => (
        <article key={s.id} className="card-surface p-5">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
            <div className="min-w-0">
              <h2 className="flex items-center gap-1.5 truncate text-base font-bold">
                {s.name}
                {s.verificationStatus === "verified" && (
                  <BadgeCheck
                    className="size-4 shrink-0 text-success"
                    aria-label={t("verification.verified")}
                  />
                )}
              </h2>
              <p className="truncate text-[11px] tracking-wide text-muted-foreground">
                {s.descriptor ?? t(`provenance.${s.provenance}`)}
              </p>
            </div>
            <CountryTag code={s.countryCode} />
          </div>

          <div className="mt-5 space-y-3 text-sm">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
              <span className="text-xs text-muted-foreground">{t("fournisseurs.confidence")}</span>
              <span className="font-semibold">
                {s.confidenceScore}
                <span className="text-xs text-muted-foreground">{t("fournisseurs.outOf100")}</span>
              </span>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
              <span className="text-xs text-muted-foreground">{t("fournisseurs.risk")}</span>
              <RiskBadge risque={RISK_LABEL[s.riskLevel]} />
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
              <span className="text-xs text-muted-foreground">{t("fournisseurs.matched")}</span>
              <span className="font-semibold">{s.matchCount}</span>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-border pt-3">
              <span className="text-xs text-muted-foreground">{t("fournisseurs.provenance")}</span>
              <span className="text-xs">{t(`provenance.${s.provenance}`)}</span>
            </div>
            {/* Which request's research surfaced this company. Absent for
                seeded/imported rows, and withheld server-side when the dossier
                belongs to another workspace. */}
            {s.discoveredByRequestId && (
              <Button variant="outline" size="sm" className="w-full" asChild>
                <Link to="/demandes/$id" params={{ id: s.discoveredByRequestId }}>
                  <ScanSearch className="size-4" />
                  {t("fournisseurs.viewSourceRequest", { id: s.discoveredByRequestId })}
                </Link>
              </Button>
            )}
          </div>
        </article>
      ))}
    </section>
  );
}

function Fournisseurs() {
  const { t } = useTranslation();
  const { directory, mine } = Route.useLoaderData();
  const { session } = Route.useRouteContext();
  const platformRole = (session?.user as { platformRole?: string } | undefined)?.platformRole;
  const employee = canSeeAllRequests(platformRole);

  const grille = <SupplierGrid suppliers={directory.suppliers} />;
  const miennes =
    mine.suppliers.length > 0 ? <SupplierGrid suppliers={mine.suppliers} /> : <MineEmpty />;

  return (
    <div className="space-y-6 pt-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div className="min-w-0">
          <h1 className="truncate font-display text-2xl font-semibold">
            {t("fournisseurs.title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("fournisseurs.subtitle", { count: directory.total })}
          </p>
        </div>
      </header>

      {employee ? <EmployeeTabs global={grille} mine={miennes} /> : grille}
    </div>
  );
}
