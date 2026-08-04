import { createFileRoute } from "@tanstack/react-router";
import { Handshake } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DossierCard } from "@/components/osi/DossierCard";
import { EmptySection } from "@/components/osi/EmptySection";
import { requirePlatformFeature } from "@/lib/auth-guard";
import { getAllRequestsFn } from "@/lib/requests-fns";

export const Route = createFileRoute("/interne/facilitation")({
  head: () => ({
    meta: [{ title: "Facilitation | OSI" }, { name: "robots", content: "noindex" }],
  }),
  beforeLoad: ({ context }) => {
    requirePlatformFeature(context.session, "facilitation");
  },
  // The ops view: every buyer's dossier, newest first, with workspace badges.
  loader: () => getAllRequestsFn(),
  component: Facilitation,
});

function Facilitation() {
  const { t } = useTranslation();
  const demandes = Route.useLoaderData();

  if (demandes.length === 0) {
    return (
      <EmptySection
        icone={Handshake}
        titleKey="empty.facilitationTitle"
        textKey="empty.facilitationText"
      />
    );
  }

  return (
    <div className="space-y-6 pt-6">
      <header className="min-w-0">
        <h1 className="truncate font-display text-2xl font-semibold">
          {t("empty.facilitationTitle")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("demandes.subtitle", { count: demandes.length })}
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {demandes.map((demande) => (
          <DossierCard key={demande.id} demande={demande} />
        ))}
      </div>
    </div>
  );
}
