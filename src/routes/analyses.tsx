import { createFileRoute, redirect } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer } from "recharts";
import { categories, kpisAnalyses, repartition, tendance } from "@/data/osi";
import { hasPlatformFeature } from "@/lib/roles";

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
      { title: "Analyses des dépenses et économies | OSI" },
      {
        name: "description",
        content:
          "Dépenses totales, économies générées, répartition géographique et catégories principales.",
      },
      { property: "og:title", content: "Analyses | OSI" },
      { property: "og:description", content: "Vos indicateurs d'approvisionnement mois par mois." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Analyses,
});

const couleurs = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-5)"];

function Analyses() {
  const { t } = useTranslation();
  return (
    <div className="space-y-6 pt-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <h1 className="truncate font-display text-2xl font-semibold">{t("analyses.title")}</h1>
        <span className="rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground">
          {t("analyses.thisMonth")}
        </span>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpisAnalyses.map((kpi) => (
          <div key={kpi.key} className="card-surface p-5">
            <p className="truncate text-xs text-muted-foreground">{t(`kpis.${kpi.key}`)}</p>
            <p className="mt-2 font-display text-2xl font-semibold">{kpi.valeur}</p>
            <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3">
              <p className="truncate text-xs">
                <span className="font-semibold text-success">{kpi.delta}</span>{" "}
                <span className="text-muted-foreground">{t("analyses.vsLastMonth")}</span>
              </p>
              <div className="h-8 w-20 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={tendance}>
                    <Line
                      type="monotone"
                      dataKey="valeur"
                      stroke="var(--chart-1)"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        ))}
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="card-surface p-6">
          <h2 className="text-sm font-semibold">{t("analyses.spendDistribution")}</h2>
          <div className="mt-4 grid grid-cols-[minmax(0,160px)_minmax(0,1fr)] items-center gap-6">
            <div className="h-40">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={repartition}
                    dataKey="valeur"
                    nameKey="key"
                    innerRadius={44}
                    outerRadius={70}
                    paddingAngle={2}
                    stroke="none"
                  >
                    {repartition.map((entry, i) => (
                      <Cell key={entry.key} fill={couleurs[i % couleurs.length]} />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <ul className="space-y-3">
              {repartition.map((zone, i) => (
                <li
                  key={zone.key}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-xs"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: couleurs[i % couleurs.length] }}
                    />
                    <span className="truncate text-muted-foreground">
                      {t(`regions.${zone.key}`)}
                    </span>
                  </span>
                  <span className="font-semibold">{zone.valeur}%</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="card-surface p-6">
          <h2 className="text-sm font-semibold">{t("analyses.mainCategories")}</h2>
          <ul className="mt-4 divide-y divide-border">
            {categories.map((cat) => (
              <li
                key={cat.key}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3 text-sm"
              >
                <span className="truncate text-muted-foreground">{t(`categories.${cat.key}`)}</span>
                <span className="font-semibold">{cat.montant}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
