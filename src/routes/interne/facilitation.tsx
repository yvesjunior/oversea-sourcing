import { createFileRoute } from "@tanstack/react-router";
import { Handshake } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DossierCard } from "@/components/osi/DossierCard";
import { EmptyRequests } from "@/components/osi/EmptyRequests";
import { EmptySection } from "@/components/osi/EmptySection";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requirePlatformFeature } from "@/lib/auth-guard";
import { getAllRequestsFn, getMyRequestsFn, type RequestSummary } from "@/lib/requests-fns";

export const Route = createFileRoute("/interne/facilitation")({
  head: () => ({
    meta: [{ title: "Facilitation | OSI" }, { name: "robots", content: "noindex" }],
  }),
  beforeLoad: ({ context }) => {
    requirePlatformFeature(context.session, "facilitation");
  },
  // The ops view: all buyers' dossiers + the employee's own, tab-filtered.
  loader: async (): Promise<{ tous: RequestSummary[]; miens: RequestSummary[] }> => {
    const [tous, miens] = await Promise.all([getAllRequestsFn(), getMyRequestsFn()]);
    return { tous, miens };
  },
  component: Facilitation,
});

function Grille({ demandes, mine }: { demandes: RequestSummary[]; mine: boolean }) {
  if (demandes.length === 0) {
    return mine ? (
      <EmptyRequests />
    ) : (
      <EmptySection
        icone={Handshake}
        titleKey="empty.facilitationTitle"
        textKey="empty.facilitationText"
      />
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

function Facilitation() {
  const { t } = useTranslation();
  const { tous, miens } = Route.useLoaderData();

  return (
    <div className="space-y-6 pt-6">
      <header className="min-w-0">
        <h1 className="truncate font-display text-2xl font-semibold">
          {t("empty.facilitationTitle")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("demandes.subtitle", { count: tous.length })}
        </p>
      </header>

      <Tabs defaultValue="tous">
        <TabsList>
          <TabsTrigger value="tous">
            {t("facilitation.tabAll")} ({tous.length})
          </TabsTrigger>
          <TabsTrigger value="miens">
            {t("facilitation.tabMine")} ({miens.length})
          </TabsTrigger>
        </TabsList>
        <TabsContent value="tous" className="mt-5">
          <Grille demandes={tous} mine={false} />
        </TabsContent>
        <TabsContent value="miens" className="mt-5">
          <Grille demandes={miens} mine />
        </TabsContent>
      </Tabs>
    </div>
  );
}
