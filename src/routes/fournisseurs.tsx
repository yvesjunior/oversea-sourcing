import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ScoreRing } from "@/components/osi/ScoreRing";
import { CountryTag } from "@/components/osi/CountryTag";
import { RiskBadge } from "@/components/osi/RiskBadge";
import { fournisseurs } from "@/data/osi";

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
  component: Fournisseurs,
});

function Fournisseurs() {
  const { t } = useTranslation();
  return (
    <div className="space-y-6 pt-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div className="min-w-0">
          <h1 className="truncate font-display text-2xl font-semibold">
            {t("fournisseurs.title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("fournisseurs.subtitle", { count: 842 })}
          </p>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {fournisseurs.map((f) => (
          <article key={f.nom} className="card-surface p-5">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-base font-bold">{f.nom}</h2>
                <p className="truncate text-[11px] tracking-wide text-muted-foreground">
                  {f.sousTitre}
                </p>
              </div>
              <CountryTag code={f.code} />
            </div>

            <div className="mt-5 space-y-3 text-sm">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                <span className="text-xs text-muted-foreground">
                  {t("fournisseurs.compatibility")}
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-semibold">{f.compatibilite}%</span>
                  <ScoreRing valeur={f.compatibilite} taille={26} />
                </span>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                <span className="text-xs text-muted-foreground">
                  {t("fournisseurs.confidence")}
                </span>
                <span className="font-semibold">
                  {f.confiance}
                  <span className="text-xs text-muted-foreground">
                    {t("fournisseurs.outOf100")}
                  </span>
                </span>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                <span className="text-xs text-muted-foreground">{t("fournisseurs.risk")}</span>
                <RiskBadge risque={f.risque} />
              </div>
            </div>

            <Button variant="goldSoft" className="mt-5 w-full">
              {t("fournisseurs.compare")}
            </Button>
          </article>
        ))}
      </section>
    </div>
  );
}
