import { useEffect } from "react";
import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { format } from "date-fns";
import { enUS, fr } from "date-fns/locale";
import {
  ArrowLeft,
  Ban,
  ExternalLink,
  FileText,
  Globe,
  Info,
  ScanSearch,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useTranslation } from "react-i18next";
import { ScoreRing } from "@/components/osi/ScoreRing";
import { Timeline, type Etape } from "@/components/osi/Timeline";
import { CountryTag } from "@/components/osi/CountryTag";
import { RiskBadge } from "@/components/osi/RiskBadge";
import { CriteriaPanel } from "@/components/osi/CriteriaPanel";
import { RequestChat } from "@/components/osi/RequestChat";
import { AttachmentsList } from "@/components/osi/AttachmentsList";
import { StatusPill } from "@/components/osi/StatusPill";
import type { Risque } from "@/data/osi";
import type { RiskLevel } from "@/database/schema";
import { cancelRequestFn, getRequestDetailFn, type RequestDetail } from "@/lib/requests-fns";
import { isInFlight, PIPELINE_ORDER, pipelineIndex, progressPct } from "@/lib/request-status";
import { cn } from "@/lib/utils";

/**
 * Only ever hand http(s) URLs to an anchor. Supplier sites come from a model
 * reading the open web, so treat them as untrusted input: a `javascript:` or
 * `data:` value in an href would execute on click.
 */
function externalUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** DB risk levels → the legacy display literals RiskBadge/i18n understand. */
const RISK_LABEL: Record<RiskLevel, Risque> = {
  low: "Faible",
  medium: "Moyen",
  high: "Élevé",
};

export const Route = createFileRoute("/demandes/$id")({
  head: ({ params }) => ({
    meta: [
      { title: `Demande #${params.id} — analyse fournisseurs | OSI` },
      {
        name: "description",
        content: `Suivi de la demande #${params.id} : critères identifiés, recherche mondiale et top 5 fournisseurs compatibles.`,
      },
      { property: "og:title", content: `Demande #${params.id} | OSI` },
      {
        property: "og:description",
        content: "Top 5 fournisseurs les plus compatibles et score de confiance.",
      },
      { property: "og:type", content: "article" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  // Real request from the DB (workspace-scoped); unknown ids go back to the list.
  loader: async ({ params }): Promise<RequestDetail> => {
    const demande = await getRequestDetailFn({ data: { id: params.id } });
    if (!demande) throw redirect({ to: "/demandes" });
    return demande;
  },
  component: DemandeDetail,
});

const etapesFlux = [
  { key: "received", icone: FileText },
  { key: "search", icone: Globe },
  { key: "validation", icone: ShieldCheck },
  { key: "report", icone: FileText },
];

function DemandeDetail() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const demande = Route.useLoaderData() as RequestDetail;
  const dateLocale = i18n.language === "fr" ? fr : enUS;

  const stepIndex = pipelineIndex(demande.status);
  const finished = demande.status === "report_ready" || demande.status === "closed";
  // Poll while the pipeline moves on its own — plus legacy "analyzing" rows
  // whose search was just launched but not yet picked up by the worker.
  const searchLaunched = demande.events.some((event) => event.type === "search.launched");
  const polling = isInFlight(demande.status) || (demande.status === "analyzing" && searchLaunched);

  useEffect(() => {
    if (!polling) return;
    const timer = setInterval(() => void router.invalidate(), 4000);
    return () => clearInterval(timer);
  }, [polling, router]);

  // Timeline: the 5 pipeline stages × recorded status.* events.
  const statusEventDate = (status: string): string | null => {
    const event = demande.events.find((e) => e.type === `status.${status}`);
    return event
      ? format(new Date(event.createdAt), "d MMM yyyy · HH:mm", { locale: dateLocale })
      : null;
  };
  const etapesTimeline: Etape[] = PIPELINE_ORDER.map((step, index) => {
    const date = statusEventDate(step.status);
    const etat =
      index < stepIndex || (finished && date) || (index === stepIndex && finished)
        ? ("termine" as const)
        : index === stepIndex
          ? ("encours" as const)
          : ("attente" as const);
    return {
      titre: t(`stepsDemande.${step.stepKey}.title`),
      detail: date ?? (etat === "encours" ? t("detail.stepInProgress") : t("detail.stepPending")),
      etat,
    };
  });

  // Data-driven: the Top-5 appears once the matching stage produced real rows.
  const showSuppliers = demande.matches.length > 0;
  const pct = progressPct(demande.status);
  const canCancel =
    demande.canEdit && !finished && demande.status !== "cancelled" && demande.status !== "draft";

  const activity = [...demande.events].reverse();

  return (
    <div className="space-y-6 pt-6">
      <header className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4">
        <Link
          to="/demandes"
          className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" />{" "}
          <span className="hidden sm:inline">{t("detail.back")}</span>
        </Link>
        <h1 className="truncate text-center font-display text-lg font-semibold">
          {t("detail.requestNo", { id: demande.id })}
          <StatusPill statut={demande.status} className="ml-2 align-middle" />
          {demande.workspaceName && (
            <span className="ml-2 align-middle rounded-full bg-gold-soft px-2 py-0.5 text-[11px] font-semibold text-gold">
              {demande.workspaceName}
            </span>
          )}
        </h1>
        <span className="flex items-center gap-2">
          {canCancel && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                void cancelRequestFn({ data: { id: demande.id } }).then(() => router.invalidate())
              }
            >
              <Ban className="size-4" /> {t("detail.cancelRequest")}
            </Button>
          )}
          {finished && (
            <Button variant="gold" size="sm" asChild>
              <Link to="/demandes/$id/rapport" params={{ id: demande.id }}>
                <FileText className="size-4" /> {t("detail.viewReport")}
              </Link>
            </Button>
          )}
        </span>
      </header>

      <section className="card-surface overflow-x-auto p-6">
        <ol className="flex min-w-[620px] items-start justify-between">
          {etapesFlux.map((etape, i) => {
            const done = i < stepIndex || (i === stepIndex && finished);
            const active = i === stepIndex && !finished;
            return (
              <li key={etape.key} className="flex flex-1 flex-col items-center gap-2 text-center">
                <div className="flex w-full items-center">
                  <span className={cn("h-px flex-1", i === 0 ? "bg-transparent" : "bg-border")} />
                  <span
                    className={cn(
                      "grid size-9 shrink-0 place-items-center rounded-full border",
                      active
                        ? "border-gold bg-gold-soft text-gold"
                        : done
                          ? "border-success/60 bg-success/10 text-success"
                          : "border-border bg-secondary text-muted-foreground",
                    )}
                  >
                    <etape.icone className="size-4" />
                  </span>
                  <span
                    className={cn(
                      "h-px flex-1",
                      i === etapesFlux.length - 1 ? "bg-transparent" : "bg-border",
                    )}
                  />
                </div>
                <span
                  className={cn(
                    "text-xs",
                    active
                      ? "font-semibold text-gold"
                      : done
                        ? "text-success"
                        : "text-muted-foreground",
                  )}
                >
                  {t(`stepsFlux.${etape.key}`)}
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <section className="card-surface p-6">
          <h2 className="text-base font-semibold">{demande.title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t("detail.progressTitle")}</p>

          {/* The buyer's own words. The title is a truncated first line and the
              criteria are derived, so without this there is nothing on the page
              showing what the search was actually built from. */}
          {demande.descriptionRaw.trim() && (
            <details className="group mt-5 rounded-lg bg-secondary/60 p-3" open>
              <summary className="cursor-pointer list-none text-[11px] font-semibold uppercase tracking-wide text-muted-foreground marker:content-none">
                {t("detail.originalNeed")}
              </summary>
              <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed">
                {demande.descriptionRaw}
              </p>
            </details>
          )}

          <Timeline etapes={etapesTimeline} className="mt-6" />

          <CriteriaPanel
            requestId={demande.id}
            criteria={demande.criteria}
            editable={demande.canEdit && !finished && demande.status !== "cancelled"}
            showLaunch={demande.canEdit && demande.status === "analyzing" && !searchLaunched}
          />

          {demande.status !== "draft" && demande.status !== "cancelled" && !finished && (
            <div className="mt-4">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                <span className="truncate text-xs text-muted-foreground">
                  {t("detail.analysisOngoing")}
                </span>
                <span className="text-sm font-semibold">{pct}%</span>
              </div>
              <Progress value={pct} className="mt-2 h-1.5" />
            </div>
          )}

          <AttachmentsList attachments={demande.attachments} />

          {activity.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-semibold">{t("detail.activityTitle")}</h3>
              <ul className="mt-2 space-y-1.5">
                {activity.map((event) => (
                  <li key={event.id} className="flex items-baseline gap-2 text-xs">
                    <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">
                      {format(new Date(event.createdAt), "d MMM · HH:mm", {
                        locale: dateLocale,
                      })}
                    </span>
                    <span className="min-w-0 text-muted-foreground">
                      {t(`events.${event.type.replace(".", "_")}`, event.params)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <div className="space-y-6">
          {showSuppliers && (
            <section className="card-surface p-6">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
                <h2 className="truncate text-base font-semibold">{t("detail.top5")}</h2>
                {demande.suppliersAnalyzed !== null && (
                  <span className="rounded-full bg-secondary px-3 py-1 text-[11px] text-muted-foreground">
                    {t("detail.analyzed", { count: demande.suppliersAnalyzed })}
                  </span>
                )}
              </div>

              <ul className="mt-5 space-y-3">
                {demande.matches.map((m) => (
                  <li
                    key={m.id}
                    className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 overflow-hidden rounded-xl border border-border transition-colors hover:border-gold/50"
                  >
                    <span
                      className={cn(
                        "grid h-full w-10 shrink-0 place-items-center font-display text-lg font-semibold",
                        m.rank === 1
                          ? "bg-gold-gradient text-gold-foreground"
                          : "bg-secondary text-muted-foreground",
                      )}
                    >
                      {m.rank}
                    </span>

                    <div className="grid min-w-0 gap-x-6 gap-y-3 py-4 pr-2 sm:grid-cols-2 xl:grid-cols-[160px_minmax(120px,auto)_auto_auto_auto] xl:items-center">
                      {/* min-w-0 + truncate, not shrink-0 + nowrap: researched
                          names run long ("Jiangyin Haixing Heat-Exchange
                          Facilities Co., Ltd.") and used to overflow this
                          track and paint over the score columns. */}
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-bold" title={m.supplier.name}>
                          {m.supplier.name}
                        </span>
                        {m.supplier.descriptor && (
                          <span
                            className="block truncate text-[11px] tracking-wide text-muted-foreground"
                            title={m.supplier.descriptor}
                          >
                            {m.supplier.descriptor}
                          </span>
                        )}
                      </span>
                      <CountryTag code={m.supplier.countryCode} />

                      <span className="flex items-center gap-2">
                        <ScoreRing valeur={m.compatibilityScore} taille={30} />
                        <span className="min-w-0">
                          <span className="block text-[11px] text-muted-foreground">
                            {t("detail.compatibility")}
                          </span>
                          <span className="block text-sm font-semibold">
                            {m.compatibilityScore}%
                          </span>
                        </span>
                      </span>
                      <span className="min-w-[92px]">
                        <span className="block text-[11px] text-muted-foreground">
                          {t("detail.confidence")}
                        </span>
                        <span className="text-sm font-semibold">
                          {m.confidenceScore}
                          <span className="text-xs text-muted-foreground">
                            {t("detail.outOf100")}
                          </span>
                        </span>
                      </span>
                      <span className="min-w-[76px]">
                        <span className="block text-[11px] text-muted-foreground">
                          {t("detail.risk")}
                        </span>
                        <RiskBadge risque={RISK_LABEL[m.riskLevel]} />
                      </span>
                    </div>

                    {/* Replaced the inert "Comparer" (E5, unwired) with the
                        action a buyer actually wants on a shortlist: see who
                        this company is. Falls back to the page the research
                        agent read them from when they have no own site. */}
                    <span className="pr-4">
                      {(externalUrl(m.supplier.website) ?? externalUrl(m.supplier.sourceRef)) ? (
                        <Button size="sm" asChild>
                          <a
                            href={
                              externalUrl(m.supplier.website) ?? externalUrl(m.supplier.sourceRef)!
                            }
                            target="_blank"
                            rel="noopener noreferrer"
                            title={m.supplier.website ?? m.supplier.sourceRef ?? undefined}
                          >
                            {t("detail.visitSite")}
                            <ExternalLink className="size-3.5" />
                          </a>
                        </Button>
                      ) : (
                        <Button size="sm" disabled title={t("detail.noSite")}>
                          {t("detail.visitSite")}
                        </Button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>

              <p className="mt-5 flex items-center gap-2 text-xs text-muted-foreground">
                <Info className="size-3.5 shrink-0" />
                {t("detail.resultsNote")}
              </p>
            </section>
          )}

          {/* Chat is platform-gated (AI_CHAT): when off, the whole section —
              transcripts included — is hidden (a conversation that can't
              continue is noise). The hero prompt is the AI entry point. */}
          {demande.aiChatEnabled && (
            <RequestChat
              requestId={demande.id}
              messages={demande.messages}
              canChat={demande.canEdit}
            />
          )}
        </div>
      </div>
    </div>
  );
}
