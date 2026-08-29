import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ChevronDown, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { DossierCard } from "@/components/osi/DossierCard";
import { HeroPrompt } from "@/components/osi/HeroPrompt";
import { EmployeeTabs } from "@/components/osi/EmployeeTabs";
import { EmptyRequests } from "@/components/osi/EmptyRequests";
import { canSeeAllRequests } from "@/lib/roles";
import { cn } from "@/lib/utils";
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
  // Staff powers exist ONLY while standing in the internal workspace, so this
  // flag doubles as "I am in OSI's own workspace" — the same signal the nav
  // and the Vue globale tabs already follow.
  const employee = canSeeAllRequests(platformRole);
  const count = employee ? toutes.length : miennes.length;
  // The intake form lives here since 2026-08-29 (ADR-002 §11) — "Création et
  // suivi" on one page. Collapsed by default so seven fields never push the
  // dossier list below the fold, but OPEN for a buyer with nothing yet: an
  // empty list plus a hidden form is a dead end.
  const [formOpen, setFormOpen] = useState(miennes.length === 0);

  return (
    <div className="space-y-6 pt-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div className="min-w-0">
          <h1 className="truncate font-display text-2xl font-semibold">{t("demandes.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("demandes.subtitle", { count })}</p>
        </div>
        {/* OSI's own workspace holds no requests (owner 2026-08-29): staff
            do not file needs there, they run other people's. The server
            refuses it too — this only stops offering it. */}
        {!employee && (
          <Button
            type="button"
            variant={formOpen ? "outline" : "gold"}
            onClick={() => setFormOpen((open) => !open)}
            aria-expanded={formOpen}
            aria-controls="nouvelle-demande"
          >
            {formOpen ? <ChevronDown className="size-4" /> : <Plus className="size-4" />}
            <span className="hidden sm:inline">{t("demandes.newRequest")}</span>
          </Button>
        )}
      </header>

      {/* Hidden with CSS, never unmounted: HeroPrompt's draft-resume effect
          runs on mount, so a draft returning from the auth gate must find the
          component alive even when the section is collapsed. */}
      <div id="nouvelle-demande" className={cn((!formOpen || employee) && "hidden")}>
        <HeroPrompt
          user={session?.user ?? null}
          variant="embedded"
          // A draft coming back from the auth gate must be VISIBLE: it is no
          // longer submitted automatically, so the buyer has to see it to
          // press the button.
          onDraftRestored={() => setFormOpen(true)}
        />
      </div>

      {/* No "Mes données" here: in OSI's own workspace a staff member has
          none by rule, and a tab that is always empty is furniture. Their own
          dossiers live in their personal workspace — one switch away. */}
      {employee ? <Grille demandes={toutes} mine={false} /> : <Grille demandes={miennes} mine />}
    </div>
  );
}
