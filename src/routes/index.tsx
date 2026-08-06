import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { HeroPrompt } from "@/components/osi/HeroPrompt";
import { StatCard } from "@/components/osi/StatCard";
import { DossierCard } from "@/components/osi/DossierCard";
import { EmptyRequests } from "@/components/osi/EmptyRequests";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { statsConfig, valeurs } from "@/data/osi";
import { canSeeAllRequests } from "@/lib/roles";
import { getAllRequestsFn, getMyRequestsFn, type RequestSummary } from "@/lib/requests-fns";
import { getAllStatsFn, getDashboardStatsFn, type DashboardStats } from "@/lib/stats-fns";

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
  // Real data, visibility by role: buyers → own · employees → global + own,
  // grouped under one tab switcher. Anonymous → zeros (the page stays public).
  loader: async () => {
    const [stats, statsAll, demandes, toutes] = await Promise.all([
      getDashboardStatsFn(),
      getAllStatsFn(), // null unless owner/manager
      getMyRequestsFn(),
      getAllRequestsFn(), // [] unless owner/manager
    ]);
    return { stats, statsAll, demandes, toutes };
  },
  component: Accueil,
});

function StatsGrid({ stats }: { stats: DashboardStats }) {
  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {statsConfig.map((config) => (
        <StatCard
          key={config.key}
          config={config}
          value={stats[config.key]}
          delta={stats.deltas[config.key]}
        />
      ))}
    </section>
  );
}

function DossiersRecents({
  demandes,
  mine,
  seeAllTo,
}: {
  demandes: RequestSummary[];
  mine: boolean;
  seeAllTo: string;
}) {
  const { t } = useTranslation();
  return (
    <section>
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <h2 className="truncate text-lg font-semibold">{t("home.recent")}</h2>
        <Link
          to={seeAllTo}
          className="flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-gold"
        >
          {t("home.seeAll")} <ChevronRight className="size-4" />
        </Link>
      </div>
      <div className="mt-5">
        {demandes.length === 0 ? (
          mine ? (
            <EmptyRequests />
          ) : (
            <p className="card-surface border-dashed px-6 py-10 text-center text-sm text-muted-foreground">
              —
            </p>
          )
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {demandes.slice(0, 4).map((demande) => (
              <DossierCard key={demande.id} demande={demande} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function Accueil() {
  const { t } = useTranslation();
  // Public route: anonymous visitors see the hero + value props; logged-in
  // users get their personal dashboard (doc/BACKLOG.md — public landing).
  const { session } = Route.useRouteContext();
  const { stats, statsAll, demandes, toutes } = Route.useLoaderData();
  const loggedIn = Boolean(session);
  const platformRole = (session?.user as { platformRole?: string } | undefined)?.platformRole;
  // Employees (owner/manager): global view + own data, one tab switcher for
  // the whole dashboard (stats + dossiers move together).
  const employee = canSeeAllRequests(platformRole) && statsAll !== null;

  return (
    <div className="flex flex-1 flex-col gap-8">
      <HeroPrompt user={session?.user ?? null} />

      {employee ? (
        /* -mt-6: the tab bar slots into the section gap instead of adding a
           row — employee and buyer dashboards keep (almost) the same height,
           so the footer stays fully visible in both. */
        <Tabs defaultValue="tous" className="-mt-6">
          <TabsList className="h-8">
            <TabsTrigger
              value="tous"
              className="py-1 data-[state=active]:bg-gold-gradient data-[state=active]:text-gold-foreground data-[state=active]:shadow-gold"
            >
              {t("home.tabAll")}
            </TabsTrigger>
            <TabsTrigger
              value="miens"
              className="py-1 data-[state=active]:bg-gold-gradient data-[state=active]:text-gold-foreground data-[state=active]:shadow-gold"
            >
              {t("home.tabMine")}
            </TabsTrigger>
          </TabsList>
          <TabsContent value="tous" className="mt-3 space-y-8">
            <StatsGrid stats={statsAll} />
            <DossiersRecents demandes={toutes} mine={false} seeAllTo="/interne/facilitation" />
          </TabsContent>
          <TabsContent value="miens" className="mt-3 space-y-8">
            <StatsGrid stats={stats} />
            <DossiersRecents demandes={demandes} mine seeAllTo="/demandes" />
          </TabsContent>
        </Tabs>
      ) : (
        <>
          {/* Buyers → own numbers · anonymous → zeros. */}
          <StatsGrid stats={stats} />
          {loggedIn && <DossiersRecents demandes={demandes} mine seeAllTo="/demandes" />}
        </>
      )}

      {/* Footer section — pinned to the bottom of the page (mt-auto). */}
      <section className="mt-auto rounded-2xl bg-sidebar px-6 py-8 text-sidebar-foreground sm:px-10">
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
