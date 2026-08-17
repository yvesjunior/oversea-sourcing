import { createFileRoute, redirect } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, XAxis } from "recharts";
import { CountryTag } from "@/components/osi/CountryTag";
import { hasPlatformFeature } from "@/lib/roles";
import { getAnalyticsFn, type AnalyticsData } from "@/lib/stats-fns";

export const Route = createFileRoute("/analyses")({
  // Employee-only surface (PLATFORM_FEATURES.analytics) — buyers land on "/".
  beforeLoad: ({ context }) => {
    const platformRole = (context.session?.user as { platformRole?: string } | undefined)
      ?.platformRole;
    if (!hasPlatformFeature(platformRole, "analytics")) {
      throw redirect({ to: "/" });
    }
  },
  head: () => ({
    meta: [
      { title: "Analyses | OSI" },
      {
        name: "description",
        content: "Demandes, pool fournisseurs et activité de recherche mondiale.",
      },
    ],
  }),
  loader: async (): Promise<AnalyticsData> => await getAnalyticsFn(),
  component: Analyses,
});

const COULEURS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-5)"];

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card-surface p-5">
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p className="mt-2 font-display text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-1 truncate text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Analyses() {
  const { t } = useTranslation();
  const data = Route.useLoaderData();
  const empty = data.requests.total === 0 && data.suppliers.total === 0;

  return (
    <div className="space-y-6 pt-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <h1 className="truncate font-display text-2xl font-semibold">{t("analyses.title")}</h1>
      </header>

      {empty ? (
        <div className="card-surface border-dashed px-6 py-10 text-center">
          <p className="text-sm font-semibold">{t("analyses.emptyTitle")}</p>
        </div>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              label={t("analyses.kpiRequests")}
              value={String(data.requests.total)}
              hint={t("analyses.kpiRequestsHint", {
                active: data.requests.active,
                completed: data.requests.completed,
              })}
            />
            <Kpi
              label={t("analyses.kpiSuppliers")}
              value={String(data.suppliers.total)}
              hint={t("analyses.kpiSuppliersHint", { added: data.research.suppliersAdded })}
            />
            <Kpi
              label={t("analyses.kpiSearches")}
              value={String(data.research.searches)}
              hint={t("analyses.kpiSearchesHint", { runs: data.research.runs })}
            />
            <Kpi
              label={t("analyses.kpiCandidates")}
              value={String(data.research.candidatesFound)}
              hint={t("analyses.kpiCandidatesHint")}
            />
          </section>

          <section className="grid gap-6 lg:grid-cols-2">
            {/* Requests per month — the only genuine time series we hold. */}
            <div className="card-surface p-6">
              <h2 className="text-base font-semibold">{t("analyses.trendTitle")}</h2>
              <div className="mt-4 h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.trend}>
                    <XAxis
                      dataKey="month"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]} fill="var(--chart-1)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Where the pool comes from — provenance is first-class (PLAN.md). */}
            <div className="card-surface p-6">
              <h2 className="text-base font-semibold">{t("analyses.provenanceTitle")}</h2>
              <div className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-6">
                <div className="h-40 w-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={data.suppliers.byProvenance}
                        dataKey="value"
                        nameKey="key"
                        innerRadius={38}
                        outerRadius={64}
                        paddingAngle={2}
                      >
                        {data.suppliers.byProvenance.map((entry, index) => (
                          <Cell key={entry.key} fill={COULEURS[index % COULEURS.length]} />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="space-y-2 text-sm">
                  {data.suppliers.byProvenance.map((entry, index) => (
                    <li key={entry.key} className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-2">
                      <span
                        className="mt-1.5 size-2 shrink-0 rounded-full"
                        style={{ background: COULEURS[index % COULEURS.length] }}
                      />
                      <span className="truncate text-muted-foreground">
                        {t(`provenance.${entry.key}`)}
                      </span>
                      <span className="font-semibold tabular-nums">{entry.value}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>

          <section className="card-surface p-6">
            <h2 className="text-base font-semibold">{t("analyses.countriesTitle")}</h2>
            <ul className="mt-4 space-y-3">
              {data.suppliers.topCountries.map((entry) => (
                <li
                  key={entry.key}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4"
                >
                  <span className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
                    <CountryTag code={entry.key} />
                    <span
                      className="h-1.5 rounded-full bg-gold-gradient"
                      style={{
                        width: `${Math.max(4, (entry.value / (data.suppliers.topCountries[0]?.value || 1)) * 100)}%`,
                      }}
                    />
                  </span>
                  <span className="text-sm font-semibold tabular-nums">{entry.value}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}

      {/* Stated, not faked: these had invented figures until 2026-08-16. */}
      <p className="text-xs text-muted-foreground">{t("analyses.pendingNote")}</p>
    </div>
  );
}
