// Sourcing report (E7) — the printable deliverable for a finished dossier.
//
// PDF export is the browser's own print-to-PDF rather than a server-rendered
// file: it needs no Chromium in the container, it is always in sync with what
// the buyer sees, and it works today. README §4 Architecture still lists Playwright for
// when reports must be *stored* as `documents` rows (that table does not exist
// yet) — this route is the seam that gets replaced then, not thrown away.

import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { format } from "date-fns";
import { enUS, fr } from "date-fns/locale";
import { ArrowLeft, Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { CountryTag } from "@/components/osi/CountryTag";
import { RiskBadge } from "@/components/osi/RiskBadge";
import { ScoreRing } from "@/components/osi/ScoreRing";
import type { Risque } from "@/data/osi";
import type { RiskLevel } from "@/database/schema";
import { getRequestDetailFn, type RequestDetail } from "@/lib/requests-fns";

const RISK_LABEL: Record<RiskLevel, Risque> = {
  low: "Faible",
  medium: "Moyen",
  high: "Élevé",
};

export const Route = createFileRoute("/demandes/$id/rapport")({
  head: ({ params }) => ({
    meta: [{ title: `Rapport — demande #${params.id} | OSI` }],
  }),
  loader: async ({ params }): Promise<RequestDetail> => {
    const demande = await getRequestDetailFn({ data: { id: params.id } });
    if (!demande) throw redirect({ to: "/demandes" });
    return demande;
  },
  component: Rapport,
});

function Rapport() {
  const { t, i18n } = useTranslation();
  const demande = Route.useLoaderData() as RequestDetail;
  const dateLocale = i18n.language === "fr" ? fr : enUS;

  const stamp = (iso: string | null) =>
    iso ? format(new Date(iso), "d MMMM yyyy · HH:mm", { locale: dateLocale }) : "—";

  const researchEvent = demande.events.find((e) => e.type === "research.completed");
  const storeHitEvent = demande.events.find((e) => e.type === "research.store_hit");
  const criteriaFromFile = demande.events.find((e) => e.type === "criteria.fromAttachment");

  return (
    <div className="space-y-6 pt-6 print:space-y-4 print:pt-0">
      {/* Screen-only controls — never part of the printed document. */}
      <header className="flex items-center justify-between gap-4 print:hidden">
        <Link
          to="/demandes/$id"
          params={{ id: demande.id }}
          className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> {t("detail.back")}
        </Link>
        <Button variant="gold" size="sm" onClick={() => window.print()}>
          <Download className="size-4" /> {t("report.download")}
        </Button>
      </header>

      <article className="card-surface space-y-8 p-8 print:border-0 print:p-0 print:shadow-none">
        {/* Letterhead */}
        <div className="flex items-start justify-between gap-6 border-b border-border pb-6">
          <div className="min-w-0">
            <p className="font-display text-2xl font-extrabold tracking-tight text-gradient-gold print:text-black">
              OSI
            </p>
            <p className="mt-0.5 text-[11px] tracking-wide text-muted-foreground">
              {t("brand.tagline")}
            </p>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <p className="text-sm font-semibold text-foreground">
              {t("report.title", { id: demande.id })}
            </p>
            <p className="mt-1">
              {t("report.issued")} {stamp(demande.completedAt ?? demande.updatedAt)}
            </p>
            {demande.workspaceName && <p>{demande.workspaceName}</p>}
          </div>
        </div>

        {/* 1 · The need, in the buyer's words */}
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t("report.needSection")}
          </h2>
          <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed">
            {demande.descriptionRaw}
          </p>
          <dl className="mt-4 grid gap-x-8 gap-y-2 text-xs sm:grid-cols-2">
            <div className="flex justify-between border-b border-border/60 pb-1">
              <dt className="text-muted-foreground">{t("report.submitted")}</dt>
              <dd className="font-medium">{stamp(demande.createdAt)}</dd>
            </div>
            <div className="flex justify-between border-b border-border/60 pb-1">
              <dt className="text-muted-foreground">{t("report.completed")}</dt>
              <dd className="font-medium">{stamp(demande.completedAt)}</dd>
            </div>
            {demande.attachments.length > 0 && (
              <div className="flex justify-between border-b border-border/60 pb-1 sm:col-span-2">
                <dt className="text-muted-foreground">{t("detail.attachments")}</dt>
                <dd className="truncate font-medium">
                  {demande.attachments.map((a) => a.filename).join(", ")}
                </dd>
              </div>
            )}
          </dl>
        </section>

        {/* 2 · Criteria the search was built on */}
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t("report.criteriaSection")}
          </h2>
          {demande.criteria.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">{t("report.noCriteria")}</p>
          ) : (
            <table className="mt-3 w-full text-sm">
              <tbody>
                {demande.criteria.map((c) => (
                  <tr key={c.id} className="border-b border-border/60">
                    <td className="py-1.5 pr-4 text-muted-foreground">{c.label}</td>
                    <td className="py-1.5 font-medium">
                      {c.value}
                      {c.unit ? ` ${c.unit}` : ""}
                      {c.required && (
                        <span className="ml-2 text-[10px] uppercase tracking-wide text-gold">
                          {t("detail.required")}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {criteriaFromFile && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              {t("events.criteria_fromAttachment", criteriaFromFile.params)}
            </p>
          )}
        </section>

        {/* 3 · The result */}
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t("report.resultsSection")}
          </h2>
          {demande.matches.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">{t("report.noResults")}</p>
          ) : (
            <ol className="mt-3 space-y-3">
              {demande.matches.map((m) => (
                <li
                  key={m.id}
                  className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 rounded-lg border border-border p-3 print:break-inside-avoid"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded font-display text-sm font-semibold text-muted-foreground ring-1 ring-border">
                    {m.rank}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold">{m.supplier.name}</span>
                    {m.supplier.descriptor && (
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {m.supplier.descriptor}
                      </span>
                    )}
                    <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                      <CountryTag code={m.supplier.countryCode} />
                      {m.supplier.website && (
                        <span className="truncate text-[11px] text-muted-foreground">
                          {m.supplier.website.replace(/^https?:\/\//, "")}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-4 text-right">
                    <span>
                      <span className="block text-[10px] uppercase text-muted-foreground">
                        {t("detail.confidence")}
                      </span>
                      <span className="text-sm font-semibold">{m.confidenceScore}/100</span>
                    </span>
                    <RiskBadge risque={RISK_LABEL[m.riskLevel]} />
                    <ScoreRing valeur={m.compatibilityScore} taille={34} />
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* 4 · How the result was produced — provenance, not decoration */}
        <section className="border-t border-border pt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {t("report.methodSection")}
          </h2>
          <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
            {researchEvent && <li>{t("events.research_completed", researchEvent.params)}</li>}
            {storeHitEvent && <li>{t("events.research_store_hit", storeHitEvent.params)}</li>}
            {demande.suppliersAnalyzed !== null && (
              <li>{t("detail.analyzed", { count: demande.suppliersAnalyzed })}</li>
            )}
            <li>{t("detail.resultsNote")}</li>
          </ul>
        </section>
      </article>
    </div>
  );
}
