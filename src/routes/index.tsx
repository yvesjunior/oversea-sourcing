import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { HeroPrompt } from "@/components/osi/HeroPrompt";
import { StatCard } from "@/components/osi/StatCard";
import { DossierCard } from "@/components/osi/DossierCard";
import { dossiers, statistiques, valeurs } from "@/data/osi";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "OSI — Approvisionnement industriel piloté par l'IA" },
      {
        name: "description",
        content:
          "OSI analyse votre besoin, compare 800+ fournisseurs vérifiés et sécurise vos transactions industrielles.",
      },
      { property: "og:title", content: "OSI — Oversea Sourcing Intelligence" },
      {
        property: "og:description",
        content: "Décrivez votre besoin, l'IA trouve les fournisseurs les plus compatibles.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Accueil,
});

function Accueil() {
  const { t } = useTranslation();
  return (
    <div className="space-y-12">
      <HeroPrompt />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {statistiques.map((stat) => (
          <StatCard key={stat.key} data={stat} />
        ))}
      </section>

      <section>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
          <h2 className="truncate text-lg font-semibold">{t("home.recent")}</h2>
          <Link
            to="/demandes"
            className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-gold"
          >
            {t("home.seeAll")} <ChevronRight className="size-4" />
          </Link>
        </div>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {dossiers.slice(0, 4).map((dossier) => (
            <DossierCard key={dossier.id} dossier={dossier} />
          ))}
        </div>
      </section>

      <section className="rounded-2xl bg-sidebar px-6 py-8 text-sidebar-foreground sm:px-10">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-center">
          <h2 className="shrink-0 font-display text-xl font-semibold lg:w-56">
            {t("home.visionTitle")}
          </h2>
          <div className="grid flex-1 gap-6 sm:grid-cols-2 lg:grid-cols-5">
            {valeurs.map((valeur) => (
              <div key={valeur.key} className="min-w-0">
                <p className="text-sm font-semibold text-gold">{t(`values.${valeur.key}.title`)}</p>
                <p className="mt-1 text-xs leading-relaxed text-sidebar-foreground/60">
                  {t(`values.${valeur.key}.text`)}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
