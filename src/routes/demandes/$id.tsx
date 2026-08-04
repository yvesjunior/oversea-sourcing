import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import {
  ArrowLeft,
  Check,
  FileText,
  Globe,
  Info,
  ScanSearch,
  Send,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useTranslation } from "react-i18next";
import { ScoreRing } from "@/components/osi/ScoreRing";
import { Timeline } from "@/components/osi/Timeline";
import { CountryTag } from "@/components/osi/CountryTag";
import { RiskBadge } from "@/components/osi/RiskBadge";
import { criteres, etapesDemande, fournisseurs } from "@/data/osi";
import { getRequestFn, type RequestSummary } from "@/lib/requests-fns";
import { cn } from "@/lib/utils";

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
  loader: async ({ params }): Promise<RequestSummary> => {
    const demande = await getRequestFn({ data: { id: params.id } });
    if (!demande) throw redirect({ to: "/demandes" });
    return demande;
  },
  component: DemandeDetail,
});

const etapesFlux = [
  { key: "received", icone: FileText },
  { key: "analysis", icone: ScanSearch },
  { key: "search", icone: Globe },
  { key: "validation", icone: ShieldCheck },
  { key: "report", icone: FileText },
];

function DemandeDetail() {
  const { t } = useTranslation();
  const demande = Route.useLoaderData() as RequestSummary;

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
          {demande.workspaceName && (
            <span className="ml-2 align-middle rounded-full bg-gold-soft px-2 py-0.5 text-[11px] font-semibold text-gold">
              {demande.workspaceName}
            </span>
          )}
        </h1>
        <Button variant="gold" size="sm">
          <FileText className="size-4" /> {t("detail.viewReport")}
        </Button>
      </header>

      <section className="card-surface overflow-x-auto p-6">
        <ol className="flex min-w-[620px] items-start justify-between">
          {etapesFlux.map((etape, i) => (
            <li key={etape.key} className="flex flex-1 flex-col items-center gap-2 text-center">
              <div className="flex w-full items-center">
                <span className={cn("h-px flex-1", i === 0 ? "bg-transparent" : "bg-border")} />
                <span
                  className={cn(
                    "grid size-9 shrink-0 place-items-center rounded-full border",
                    i === 2
                      ? "border-gold bg-gold-soft text-gold"
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
                  i === 2 ? "font-semibold text-gold" : "text-muted-foreground",
                )}
              >
                {t(`stepsFlux.${etape.key}`)}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <section className="card-surface p-6">
          <h2 className="text-base font-semibold">{demande.title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{t("detail.progressTitle")}</p>
          <Timeline etapes={etapesDemande} className="mt-6" />

          <div className="mt-6 rounded-xl border border-border bg-secondary/60 p-4">
            <h3 className="text-sm font-semibold">{t("detail.analysisInProgress")}</h3>
            <ul className="mt-3 space-y-2">
              {criteres.map((critere) => (
                <li key={critere} className="flex gap-2 text-xs text-muted-foreground">
                  <Check className="size-3.5 shrink-0 text-success" />
                  <span className="min-w-0">{t(critere)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
              <span className="truncate text-xs text-muted-foreground">
                {t("detail.analysisOngoing")}
              </span>
              <span className="text-sm font-semibold">65%</span>
            </div>
            <Progress value={65} className="mt-2 h-1.5" />
          </div>
        </section>

        <div className="space-y-6">
          <section className="card-surface p-6">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
              <h2 className="truncate text-base font-semibold">{t("detail.top5")}</h2>
              <span className="rounded-full bg-secondary px-3 py-1 text-[11px] text-muted-foreground">
                {t("detail.analyzed", { count: 87 })}
              </span>
            </div>

            <ul className="mt-5 space-y-3">
              {fournisseurs.map((f) => (
                <li
                  key={f.nom}
                  className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 overflow-hidden rounded-xl border border-border transition-colors hover:border-gold/50"
                >
                  <span
                    className={cn(
                      "grid h-full w-10 shrink-0 place-items-center font-display text-lg font-semibold",
                      f.rang === 1
                        ? "bg-gold-gradient text-gold-foreground"
                        : "bg-secondary text-muted-foreground",
                    )}
                  >
                    {f.rang}
                  </span>

                  <div className="grid min-w-0 gap-x-6 gap-y-3 py-4 pr-2 sm:grid-cols-2 xl:grid-cols-[160px_minmax(120px,auto)_auto_auto_auto] xl:items-center">
                    <span className="shrink-0">
                      <span className="block whitespace-nowrap text-sm font-bold">{f.nom}</span>
                      <span className="block whitespace-nowrap text-[11px] tracking-wide text-muted-foreground">
                        {f.sousTitre}
                      </span>
                    </span>
                    <CountryTag code={f.code} className="whitespace-nowrap" />

                    <span className="flex items-center gap-2">
                      <ScoreRing valeur={f.compatibilite} taille={30} />
                      <span className="min-w-0">
                        <span className="block text-[11px] text-muted-foreground">
                          {t("detail.compatibility")}
                        </span>
                        <span className="block text-sm font-semibold">{f.compatibilite}%</span>
                      </span>
                    </span>
                    <span className="min-w-[92px]">
                      <span className="block text-[11px] text-muted-foreground">
                        {t("detail.confidence")}
                      </span>
                      <span className="text-sm font-semibold">
                        {f.confiance}
                        <span className="text-xs text-muted-foreground">
                          {t("detail.outOf100")}
                        </span>
                      </span>
                    </span>
                    <span className="min-w-[76px]">
                      <span className="block text-[11px] text-muted-foreground">
                        {t("detail.risk")}
                      </span>
                      <RiskBadge risque={f.risque} />
                    </span>
                  </div>

                  <span className="pr-4">
                    <Button size="sm">{t("detail.compare")}</Button>
                  </span>
                </li>
              ))}
            </ul>

            <p className="mt-5 flex items-center gap-2 text-xs text-muted-foreground">
              <Info className="size-3.5 shrink-0" />
              {t("detail.resultsNote")}
            </p>
          </section>

          <section className="card-surface overflow-hidden">
            <div className="border-b border-border px-6 py-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <ScanSearch className="size-4 text-gold" /> {t("detail.assistant")}
              </h2>
            </div>
            <div className="space-y-4 p-6">
              <div className="max-w-lg rounded-xl bg-secondary p-4 text-xs leading-relaxed text-muted-foreground">
                {t("detail.chatUnderstood")}
                <ul className="mt-2 space-y-1">
                  {criteres.slice(0, 4).map((c) => (
                    <li key={c}>• {t(c)}</li>
                  ))}
                </ul>
                <p className="mt-2">{t("detail.chatMore")}</p>
              </div>
              <div className="flex justify-end">
                <p className="max-w-sm rounded-xl bg-primary p-4 text-xs leading-relaxed text-primary-foreground">
                  {t("detail.chatUser")}
                </p>
              </div>
              <div className="max-w-lg rounded-xl bg-secondary p-4 text-xs text-muted-foreground">
                {t("detail.chatRelaunch")}
              </div>
              <form
                onSubmit={(e) => e.preventDefault()}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-border px-4 py-2"
              >
                <input
                  placeholder={t("detail.chatPlaceholder")}
                  className="min-w-0 bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground"
                />
                <Button type="submit" size="icon" variant="ghost" aria-label={t("detail.send")}>
                  <Send className="size-4 text-gold" />
                </Button>
              </form>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
