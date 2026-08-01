import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { DossierCard } from "@/components/osi/DossierCard";
import { dossiers } from "@/data/osi";

export const Route = createFileRoute("/demandes/")({
  head: () => ({
    meta: [
      { title: "Demandes d'approvisionnement | OSI" },
      {
        name: "description",
        content:
          "Suivez toutes vos demandes d'approvisionnement, leur statut et leur compatibilité.",
      },
      { property: "og:title", content: "Demandes d'approvisionnement | OSI" },
      {
        property: "og:description",
        content: "Statut, compatibilité et avancement de chaque dossier.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Demandes,
});

function Demandes() {
  const { t } = useTranslation();
  return (
    <div className="space-y-6 pt-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div className="min-w-0">
          <h1 className="truncate font-display text-2xl font-semibold">{t("demandes.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("demandes.subtitle", { count: dossiers.length })}
          </p>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {dossiers.map((dossier) => (
          <DossierCard key={dossier.id} dossier={dossier} />
        ))}
      </div>
    </div>
  );
}
