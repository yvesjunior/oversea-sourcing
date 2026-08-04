import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { DossierCard } from "@/components/osi/DossierCard";
import { EmployeeTabs } from "@/components/osi/EmployeeTabs";
import { EmptyRequests } from "@/components/osi/EmptyRequests";
import { canSeeAllRequests } from "@/lib/roles";
import { getAllRequestsFn, getMyRequestsFn, type RequestSummary } from "@/lib/requests-fns";

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
  loader: async () => {
    const [miennes, toutes] = await Promise.all([getMyRequestsFn(), getAllRequestsFn()]);
    return { miennes, toutes };
  },
  component: Demandes,
});

function Grille({ demandes, mine }: { demandes: RequestSummary[]; mine: boolean }) {
  const { t } = useTranslation();
  if (demandes.length === 0) {
    return mine ? (
      <EmptyRequests />
    ) : (
      <p className="card-surface border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
        {t("tabs.nothingMine")}
      </p>
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {demandes.map((demande) => (
        <DossierCard key={demande.id} demande={demande} />
      ))}
    </div>
  );
}

function Demandes() {
  const { t } = useTranslation();
  const { session } = Route.useRouteContext();
  const { miennes, toutes } = Route.useLoaderData();
  const platformRole = (session?.user as { platformRole?: string } | undefined)?.platformRole;
  const employee = canSeeAllRequests(platformRole);
  const count = employee ? toutes.length : miennes.length;

  return (
    <div className="space-y-6 pt-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div className="min-w-0">
          <h1 className="truncate font-display text-2xl font-semibold">{t("demandes.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("demandes.subtitle", { count })}</p>
        </div>
      </header>

      {employee ? (
        <EmployeeTabs
          globalCount={toutes.length}
          mineCount={miennes.length}
          global={<Grille demandes={toutes} mine={false} />}
          mine={<Grille demandes={miennes} mine />}
        />
      ) : (
        <Grille demandes={miennes} mine />
      )}
    </div>
  );
}
