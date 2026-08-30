import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { HeroPrompt } from "@/components/osi/HeroPrompt";
import { StatCard } from "@/components/osi/StatCard";
import { EmptyRequests } from "@/components/osi/EmptyRequests";
import { StatusPill } from "@/components/osi/StatusPill";
import { statsConfig, valeurs } from "@/data/osi";
import { formatDay, formatDayTime } from "@/lib/instant";
import { canSeeAllRequests } from "@/lib/roles";
import { getAllRequestsFn, getMyRequestsFn, type RequestSummary } from "@/lib/requests-fns";
import {
  getAllStatsFn,
  getDashboardStatsFn,
  getRecentActivityFn,
  type ActivityEntry,
  type DashboardStats,
} from "@/lib/stats-fns";

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
    const [stats, statsAll, demandes, toutes, activity] = await Promise.all([
      getDashboardStatsFn(),
      getAllStatsFn(), // null unless owner/manager
      getMyRequestsFn(),
      getAllRequestsFn(), // [] unless owner/manager
      getRecentActivityFn(), // [] when anonymous
    ]);
    return { stats, statsAll, demandes, toutes, activity };
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

/**
 * Recent requests as a TABLE (visual dossier §1), not cards.
 *
 * The dossier's columns are ID · Produit · Quantité · Statut · Soumissions ·
 * Date limite. Four of those exist here. **Quantité and Date limite do not**:
 * quantity lives inside the structured intake as free text ("5 000 unités",
 * "12 palettes" — the buyer's own wording, deliberately not something to
 * compute with) and there is no deadline field at all. Inventing either column
 * would be the Économies tile again, so the table shows what the row actually
 * knows and stops there.
 */
function DossiersRecents({
  demandes,
  mine,
  seeAllTo,
}: {
  demandes: RequestSummary[];
  mine: boolean;
  seeAllTo: string;
}) {
  const { t, i18n } = useTranslation();
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
          <div className="card-surface overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">{t("home.col.id")}</th>
                  <th className="px-4 py-3 font-medium">{t("home.col.product")}</th>
                  <th className="px-4 py-3 font-medium">{t("home.col.status")}</th>
                  <th className="px-4 py-3 font-medium">{t("home.col.quotes")}</th>
                  <th className="px-4 py-3 font-medium">{t("home.col.updated")}</th>
                </tr>
              </thead>
              <tbody>
                {demandes.slice(0, 6).map((demande) => (
                  <tr
                    key={demande.id}
                    className="border-b border-border last:border-0 transition-colors hover:bg-secondary/40"
                  >
                    <td className="px-4 py-3">
                      <Link
                        to="/demandes/$id"
                        params={{ id: demande.id }}
                        className="font-mono text-xs font-semibold text-gold hover:underline"
                      >
                        #{demande.id}
                      </Link>
                    </td>
                    <td className="max-w-[260px] px-4 py-3">
                      <span className="block truncate" title={demande.title}>
                        {demande.title}
                      </span>
                      {demande.workspaceName && (
                        <span className="text-[11px] text-muted-foreground">
                          {demande.workspaceName}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill statut={demande.status} />
                    </td>
                    <td className="px-4 py-3 tabular-nums text-muted-foreground">
                      {demande.quoteCount}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {formatDay(demande.updatedAt, i18n.language)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

/** "Activités récentes" (visual dossier §1) — merged from the three event
 *  tables the state machines already write, so the feed and the timeline a
 *  user opens from it can never tell different stories. */
function ActivitesRecentes({ entries }: { entries: ActivityEntry[] }) {
  const { t, i18n } = useTranslation();
  if (entries.length === 0) return null;
  return (
    <section>
      <h2 className="text-lg font-semibold">{t("home.activity")}</h2>
      <ul className="card-surface mt-5 divide-y divide-border">
        {entries.map((entry) => (
          <li key={entry.id} className="px-5 py-3">
            <Link to={entry.link} className="group grid grid-cols-[minmax(0,1fr)_auto] gap-4">
              <span className="min-w-0 truncate text-sm">
                <span className="transition-colors group-hover:text-gold">
                  {t(`events.${entry.type.replace(".", "_")}`, {
                    defaultValue: t(`contrats.event.${entry.type.replace(".", "_")}`, {
                      defaultValue: entry.type,
                    }),
                  })}
                </span>
                <span className="ml-2 text-muted-foreground">{entry.subject}</span>
              </span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {formatDayTime(entry.at, i18n.language, { withYear: false })}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Accueil() {
  const { t } = useTranslation();
  // Public route, two faces (ADR-002 §11, owner 2026-08-29 "define Home as
  // Dashboard"): anonymous visitors get the landing — hero, the request form
  // (that mount IS the auth gate) and the value props; signed-in users get
  // the DASHBOARD. The form moved to /demandes for them, so this route keeps
  // its own header rather than borrowing the hero's greeting.
  const { session } = Route.useRouteContext();
  const { stats, statsAll, demandes, toutes, activity } = Route.useLoaderData();
  const loggedIn = Boolean(session);
  const platformRole = (session?.user as { platformRole?: string } | undefined)?.platformRole;
  // Employees (owner/manager) standing in OSI's own workspace: the global
  // view IS their dashboard. There is no "own data" half — the platform
  // workspace holds no requests by rule (owner 2026-08-29), so that tab could
  // only ever show zeros; a staff member's own dossiers live in their
  // personal workspace, one switch away.
  const employee = canSeeAllRequests(session?.platformFeatures) && statsAll !== null;

  const prenom = session?.user?.name?.split(" ")[0];

  return (
    <div className="flex flex-1 flex-col gap-8">
      {loggedIn ? (
        <header className="pt-4">
          <h1 className="font-display text-3xl font-semibold leading-tight">
            {t("home.greeting", { name: prenom })}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("home.dashboardSubtitle")}</p>
        </header>
      ) : (
        <HeroPrompt user={null} />
      )}

      {employee ? (
        <>
          <StatsGrid stats={statsAll} />
          <DossiersRecents demandes={toutes} mine={false} seeAllTo="/interne/facilitation" />
          <ActivitesRecentes entries={activity} />
        </>
      ) : (
        <>
          {/* Buyers → own numbers · anonymous → zeros. */}
          <StatsGrid stats={stats} />
          {loggedIn && <DossiersRecents demandes={demandes} mine seeAllTo="/demandes" />}
          {loggedIn && <ActivitesRecentes entries={activity} />}
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
