import { useEffect, useState } from "react";
import { createFileRoute, Link, redirect, useRouter } from "@tanstack/react-router";
import { format } from "date-fns";
import { enUS, fr } from "date-fns/locale";
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  ClipboardCheck,
  ExternalLink,
  FileText,
  Globe,
  Info,
  ListChecks,
  Package,
  RefreshCw,
  ScanSearch,
  Send,
  ShieldCheck,
  PackageOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useTranslation } from "react-i18next";
import { requestQuotesFn } from "@/lib/quote-fns";
import {
  draftContractsFn,
  getRequestDealStatusFn,
  type RequestDealStatus,
} from "@/lib/contract-fns";
import { ScoreRing } from "@/components/osi/ScoreRing";
import { Timeline, type Etape } from "@/components/osi/Timeline";
import { CountryTag } from "@/components/osi/CountryTag";
import { RiskBadge } from "@/components/osi/RiskBadge";
import { CriteriaPanel } from "@/components/osi/CriteriaPanel";
import { RequestChat } from "@/components/osi/RequestChat";
import { SpecPanel } from "@/components/osi/SpecPanel";
import { getRequestSpecFn, type SpecView } from "@/lib/spec-fns";
import { AttachmentsList } from "@/components/osi/AttachmentsList";
import { StatusPill } from "@/components/osi/StatusPill";
import { ShortlistPanel } from "@/components/osi/ShortlistPanel";
import { getShortlistFn, type ShortlistData } from "@/lib/shortlist-fns";
import { RfqPanel } from "@/components/osi/RfqPanel";
import { getRfqPreviewFn, type RfqPreview } from "@/lib/rfq-fns";
import { OfferRankingPanel } from "@/components/osi/OfferRankingPanel";
import { getOfferRankingFn, type OfferRankingView } from "@/lib/kpi-fns";
import { DecisionPackPanel } from "@/components/osi/DecisionPackPanel";
import { getPackForRequestFn, type RequestPackView } from "@/lib/pack-fns";
import type { Risque } from "@/data/osi";
import type { RiskLevel } from "@/database/schema";
import {
  cancelRequestFn,
  getRequestDetailFn,
  launchDraftFn,
  validateSpecFn,
  rerunResearchFn,
  type RequestDetail,
} from "@/lib/requests-fns";
import {
  beforeLaunch,
  criteriaEditable,
  isInFlight,
  isTerminal,
  pipelineFor,
  pipelineIndex,
  progressPct,
  type StepKey,
} from "@/lib/request-status";
import { formatDayTime } from "@/lib/instant";
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
  loader: async ({ params }) => {
    const demande = await getRequestDetailFn({ data: { id: params.id } });
    if (!demande) throw redirect({ to: "/demandes" });
    // P5 — the dossier says whether the transaction it opened still owes a
    // required contract. Same mapping as the drafting fn, so the two cannot
    // disagree; it returns an empty shape when no offer has been accepted.
    const dossier = await getRequestDealStatusFn({ data: { requestId: params.id } });
    // The internal shortlist (V05) — only a pack-flow request has one, and the
    // fn answers null for anyone but staff holding `deals`, so the workspace
    // that owns the request never receives it.
    const shortlist =
      demande.flow === "pack" ? await getShortlistFn({ data: { requestId: params.id } }) : null;
    // Who the RFQ would go to, what stops it, and the email itself (V06) —
    // same gate as the shortlist, so again never sent to the owning workspace.
    const rfq = shortlist ? await getRfqPreviewFn({ data: { requestId: params.id } }) : null;
    // The ranking of the offers the round closed with (V09) — same gate
    // again, and null until a round has closed into the review.
    const ranking = shortlist ? await getOfferRankingFn({ data: { requestId: params.id } }) : null;
    // The pack built from that ranking (V10) — the same gate once more: a
    // pending pack is OSI's draft, and the owning workspace gets none of it.
    const pack = shortlist ? await getPackForRequestFn({ data: { requestId: params.id } }) : null;
    // The cahier des charges (V19) — null on a draft and on a request that
    // finished before specifications existed.
    const spec = await getRequestSpecFn({ data: { requestId: params.id } });
    return { demande, dossier, shortlist, rfq, ranking, pack, spec };
  },
  component: DemandeDetail,
});

/** One icon per stage, for both flows — keyed by the pipeline's `StepKey`, so
 *  a stage added to request-status.ts without an icon fails to compile here
 *  rather than rendering a hole. */
const STEP_ICONS: Record<StepKey, typeof FileText> = {
  received: FileText,
  search: Globe,
  validation: ShieldCheck,
  report: FileText,
  // Pack flow (Phase V · V04).
  shortlist: ListChecks,
  rfq: Send,
  review: ClipboardCheck,
  pack: Package,
};

function DemandeDetail() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { session } = Route.useRouteContext();
  const { demande, dossier, shortlist, rfq, ranking, pack, spec } = Route.useLoaderData() as {
    spec: SpecView | null;
    demande: RequestDetail;
    dossier: RequestDealStatus;
    shortlist: ShortlistData | null;
    rfq: RfqPreview | null;
    ranking: OfferRankingView | null;
    pack: RequestPackView | null;
  };
  const [drafting, setDrafting] = useState(false);
  const dateLocale = i18n.language === "fr" ? fr : enUS;

  // The stages follow the flow the request is actually ON (derived server-side
  // from where it has been), so a pack-flow dossier draws seven and a
  // report-flow one keeps its four.
  const steps = pipelineFor(demande.flow);
  const stepIndex = pipelineIndex(demande.status, demande.flow);
  const finished = demande.status === "report_ready" || demande.status === "closed";
  // Ended without a pack: staff refused to send one. Terminal, and NOT
  // "finished" — there is nothing to read.
  const unfulfilled = demande.status === "unfulfilled";
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
  // The LATEST entry into a stage, not the first: a request can come back —
  // a research re-run, a relaunched RFQ round — and the stage's date is when
  // it last got there.
  const statusEventDate = (status: string): string | null => {
    const event = [...demande.events].reverse().find((e) => e.type === `status.${status}`);
    return event ? formatDayTime(event.createdAt, i18n.language) : null;
  };
  const etapesTimeline: Etape[] = steps.map((step, index) => {
    const date = statusEventDate(step.status);
    const etat =
      index < stepIndex || (finished && date) || (index === stepIndex && finished)
        ? ("termine" as const)
        : index === stepIndex
          ? ("encours" as const)
          : ("attente" as const);
    return {
      titre: t(`stepsDemande.${step.stepKey}.title`),
      // A stage still ahead shows no date, even if the request has been there
      // before: after a return, an old date under a waiting stage reads as
      // "already done".
      detail:
        (etat === "attente" ? null : date) ??
        (etat === "encours" ? t("detail.stepInProgress") : t("detail.stepPending")),
      etat,
    };
  });

  // Data-driven: the Top-5 appears once the matching stage produced real rows.
  // Not beside the shortlist panel, though — that IS the same ranking, with
  // its reasons and its one decision, and two lists of the same suppliers on
  // one page would only ask which is the real one.
  const showSuppliers = demande.matches.length > 0 && shortlist === null;
  // P2 — the BUYER picks who OSI approaches (owner 2026-08-29). Nothing is
  // solicited without this selection: no automatic outreach, ever.
  const [picked, setPicked] = useState<string[]>([]);
  const [asking, setAsking] = useState(false);
  // What the last ask actually did. "0 approached" with no reason is what made
  // a re-ask look broken: the supplier was already being solicited, or had
  // already answered, and nothing on screen said so.
  const [askOutcome, setAskOutcome] = useState<string | null>(null);
  const togglePick = (supplierId: string) =>
    setPicked((current) =>
      current.includes(supplierId)
        ? current.filter((id) => id !== supplierId)
        : [...current, supplierId],
    );
  const askForQuotes = async () => {
    if (picked.length === 0 || asking) return;
    setAsking(true);
    try {
      const result = await requestQuotesFn({
        data: { requestId: demande.id, supplierIds: picked },
      });
      if (!result.ok) {
        setAskOutcome(
          result.reason === "plan_required"
            ? t("soumissions.askRefusal_plan_required", { plan: result.planName })
            : t(`soumissions.askRefusal_${result.reason}`),
        );
        return;
      }
      const parts: string[] = [];
      if (result.created > 0) parts.push(t("soumissions.askCreated", { count: result.created }));
      if (result.reopened > 0) parts.push(t("soumissions.askReopened", { count: result.reopened }));
      if (result.skipped > 0) parts.push(t("soumissions.askSkipped", { count: result.skipped }));
      setAskOutcome(parts.join(" · "));
      setPicked([]);
    } finally {
      setAsking(false);
    }
  };
  // A failed collection is the one dossier state a re-run can repair. The
  // server decides whether to offer it (canRerunResearch); this only carries
  // the click. Success sends the request back to `searching`, so `polling`
  // picks it up on the next invalidate and the page follows it live.
  const [rerunning, setRerunning] = useState(false);
  const [rerunRefused, setRerunRefused] = useState(false);
  const rerunResearch = async () => {
    if (rerunning) return;
    setRerunning(true);
    setRerunRefused(false);
    try {
      const result = await rerunResearchFn({ data: { id: demande.id } });
      if (!result.ok) setRerunRefused(true);
      await router.invalidate();
    } finally {
      setRerunning(false);
    }
  };

  // A held draft (V18): created, counted, and waiting for the buyer to launch
  // it. Nothing runs until they do — this button is the only way forward.
  const draft = demande.status === "draft";
  const [launching, setLaunching] = useState(false);
  const launchDraft = async () => {
    if (launching) return;
    setLaunching(true);
    try {
      await launchDraftFn({ data: { id: demande.id } });
      await router.invalidate();
    } finally {
      setLaunching(false);
    }
  };

  // Waiting for its buyer's validation (V20): the specification below is what
  // will be searched and sent to suppliers. Nothing runs until they approve —
  // the version they approve being the one on this page.
  const inReview = demande.status === "spec_review";
  const [validating, setValidating] = useState(false);
  const [validationRefusal, setValidationRefusal] = useState<string | null>(null);
  const validateSpec = async () => {
    if (validating || !spec) return;
    setValidating(true);
    setValidationRefusal(null);
    try {
      const result = await validateSpecFn({ data: { id: demande.id, version: spec.version } });
      if (!result.ok) setValidationRefusal(result.reason);
      await router.invalidate();
    } finally {
      setValidating(false);
    }
  };

  const pct = progressPct(demande.status, demande.flow);
  // A draft can be cancelled too: before V18 none ever rested long enough to
  // be seen, now one waits for as long as the buyer leaves it.
  const canCancel = demande.canEdit && !finished && !isTerminal(demande.status);

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
          <StatusPill statut={demande.status} flow={demande.flow} className="ml-2 align-middle" />
          {demande.workspaceName && (
            <span className="ml-2 align-middle rounded-full bg-gold-soft px-2 py-0.5 text-[11px] font-semibold text-gold">
              {demande.workspaceName}
            </span>
          )}
          <span className="ml-2 align-middle text-xs font-normal text-muted-foreground">
            {t("dossier.createdBy")} {demande.createdByName ?? t("common.deletedUser")}
          </span>
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
          {/* The printable report is the REPORT flow's answer. A pack-flow
              dossier has no Top-N to print — its answer is the Decision Pack,
              which gets its own view (Phase V · V12). */}
          {finished && demande.flow === "report" && (
            <Button variant="gold" size="sm" asChild>
              <Link to="/demandes/$id/rapport" params={{ id: demande.id }}>
                <FileText className="size-4" /> {t("detail.viewReport")}
              </Link>
            </Button>
          )}
          {/* …and here it is (V12). `finished` on the pack flow means the pack
              was released; the page itself sends back anyone it has nothing
              to show. */}
          {finished && demande.flow === "pack" && (
            <Button variant="gold" size="sm" asChild>
              <Link to="/demandes/$id/pack" params={{ id: demande.id }}>
                <PackageOpen className="size-4" /> {t("detail.viewPack")}
              </Link>
            </Button>
          )}
        </span>
      </header>

      <section className="card-surface overflow-x-auto p-6">
        <ol
          className={cn(
            "flex items-start justify-between",
            steps.length > 4 ? "min-w-[900px]" : "min-w-[620px]",
          )}
        >
          {steps.map((step, i) => {
            const Icone = STEP_ICONS[step.stepKey];
            const done = i < stepIndex || (i === stepIndex && finished);
            // A refused request stopped AT the review stage: it is neither
            // done nor still in progress there.
            const stopped = unfulfilled && i === stepIndex;
            const active = i === stepIndex && !finished && !unfulfilled;
            return (
              <li
                key={step.stepKey}
                className="flex flex-1 flex-col items-center gap-2 text-center"
              >
                <div className="flex w-full items-center">
                  <span className={cn("h-px flex-1", i === 0 ? "bg-transparent" : "bg-border")} />
                  <span
                    className={cn(
                      "grid size-9 shrink-0 place-items-center rounded-full border",
                      active
                        ? "border-gold bg-gold-soft text-gold"
                        : stopped
                          ? "border-destructive/60 bg-destructive/10 text-destructive"
                          : done
                            ? "border-success/60 bg-success/10 text-success"
                            : "border-border bg-secondary text-muted-foreground",
                    )}
                  >
                    <Icone className="size-4" />
                  </span>
                  <span
                    className={cn(
                      "h-px flex-1",
                      i === steps.length - 1 ? "bg-transparent" : "bg-border",
                    )}
                  />
                </div>
                <span
                  className={cn(
                    "text-xs",
                    active
                      ? "font-semibold text-gold"
                      : stopped
                        ? "font-semibold text-destructive"
                        : done
                          ? "text-success"
                          : "text-muted-foreground",
                  )}
                >
                  {t(`stepsFlux.${step.stepKey}`)}
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      {/* A buyer who waited through an RFQ window and a review has to be
          told something (README §2c) — silence is the one outcome that cannot
          be defended. */}
      {unfulfilled && (
        <section
          role="status"
          className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4"
        >
          <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{t("detail.unfulfilledTitle")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t("detail.unfulfilledText")}</p>
            {/* Staff's reason, written for the buyer (V11) — required when a
                pack is refused, so it is only ever absent on a request that
                reached this state before the reason existed. */}
            {demande.unfulfilledReason && (
              <p className="mt-2 text-sm">
                <span className="font-semibold">{t("detail.unfulfilledReason")}</span>{" "}
                <span className="whitespace-pre-wrap">{demande.unfulfilledReason}</span>
              </p>
            )}
          </div>
        </section>
      )}

      {draft && (
        <section
          role="status"
          className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 rounded-xl border border-gold/40 bg-gold-soft/40 p-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center"
        >
          <Info className="mt-0.5 size-5 shrink-0 text-gold sm:mt-0" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{t("clarify.draftTitle")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {/* The assistant is only mentioned where it can be used: a
                  draft outlives the flag that created it (AI_CHAT off). */}
              {!demande.canEdit
                ? t("clarify.draftTextReadOnly")
                : demande.aiChatEnabled
                  ? t("clarify.draftText")
                  : t("clarify.draftTextNoAssistant")}
            </p>
          </div>
          {demande.canEdit && (
            <Button
              type="button"
              variant="gold"
              className="col-span-2 sm:col-span-1"
              disabled={launching}
              onClick={() => void launchDraft()}
            >
              <ScanSearch className="size-4" />{" "}
              {demande.validationOn ? t("validation.present") : t("clarify.launch")}
            </Button>
          )}
        </section>
      )}

      {inReview && (
        <section role="status" className="rounded-xl border border-gold/40 bg-gold-soft/40 p-4">
          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3">
            <ClipboardCheck className="mt-0.5 size-5 shrink-0 text-gold" />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">{t("validation.title")}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {demande.canEdit ? t("validation.text") : t("validation.textReadOnly")}
              </p>

              {/* What is missing, from the criteria themselves — no model
                  involved, so it is there whether or not the assistant is. */}
              {demande.missingBasics.length > 0 && (
                <div className="mt-3 rounded-lg border border-warning/50 bg-warning/10 p-3">
                  <h3 className="flex items-center gap-2 text-sm font-semibold">
                    <AlertTriangle className="size-4 shrink-0 text-warning" />
                    {t("validation.missingTitle")}
                  </h3>
                  <ul className="mt-1 list-disc space-y-0.5 pl-9 text-sm">
                    {demande.missingBasics.map((category) => (
                      <li key={category}>{t(`validation.missing.${category}`)}</li>
                    ))}
                  </ul>
                  {demande.canEdit && (
                    <p className="mt-2 text-xs text-muted-foreground">
                      {t("validation.missingHint")}
                    </p>
                  )}
                </div>
              )}

              {demande.canEdit && spec && (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    variant="gold"
                    disabled={validating}
                    onClick={() => void validateSpec()}
                  >
                    <ClipboardCheck className="size-4" />{" "}
                    {t("validation.validate", { version: spec.version })}
                  </Button>
                  <span className="text-xs text-muted-foreground">{t("validation.edit")}</span>
                </div>
              )}
              {validationRefusal && (
                <p role="alert" className="mt-2 text-xs text-destructive">
                  {t(`validation.refused.${validationRefusal}`)}
                </p>
              )}
            </div>
          </div>
        </section>
      )}

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
            editable={demande.canEdit && criteriaEditable(demande.status)}
            showLaunch={demande.canEdit && demande.status === "analyzing" && !searchLaunched}
          />

          {demande.status !== "draft" && !isTerminal(demande.status) && !finished && (
            <div className="mt-4">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                <span className="truncate text-xs text-muted-foreground">
                  {/* "Analysis in progress" is true while the pipeline runs.
                      On the pack flow's resting states it is not — staff or
                      suppliers hold the next move — so say which stage. */}
                  {isInFlight(demande.status) || demande.status === "analyzing"
                    ? t("detail.analysisOngoing")
                    : t(`statuses.${demande.status}`)}
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
                      {formatDayTime(event.createdAt, i18n.language, { withYear: false })}
                    </span>
                    <span className="min-w-0 text-muted-foreground">
                      {t(
                        // `report_ready` on the pack flow is a pack released,
                        // not a report — same status, different event to read.
                        demande.flow === "pack" && event.type === "status.report_ready"
                          ? "events.pack_released"
                          : `events.${event.type.replace(".", "_")}`,
                        event.params,
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <div className="space-y-6">
          {/* P5 — the dossier de transaction, once an offer is accepted. The
              missing-contract warning lives HERE and not only on /contrats:
              the gap belongs where the work is, and the buyer should see it
              too, not just whoever opens the contract centre. */}
          {dossier.deal && (
            <section className="card-surface p-6">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold">{t("dealBox.title")}</h2>
                  <p className="mt-1 truncate text-sm text-muted-foreground">
                    {dossier.deal.supplierName}
                  </p>
                </div>
                <span className="rounded-full border border-border px-3 py-1 text-[11px] font-semibold">
                  {t(`dealBox.status.${dossier.deal.status}`)}
                </span>
              </div>

              {dossier.contracts.length > 0 && (
                <ul className="mt-4 space-y-2">
                  {dossier.contracts.map((contract) => (
                    <li
                      key={contract.id}
                      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-lg border border-border px-4 py-2.5"
                    >
                      <Link
                        to="/contrats/$id"
                        params={{ id: contract.id }}
                        className="min-w-0 truncate text-sm hover:text-gold"
                      >
                        <span className="font-mono text-xs font-semibold text-gold">
                          {contract.number}
                        </span>
                        <span className="ml-2 text-muted-foreground">
                          {t(`contrats.type.${contract.type}`)}
                        </span>
                      </Link>
                      <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                        {contract.signed} / {contract.requiredSignatures}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {dossier.missing.length > 0 && (
                <div className="mt-4 rounded-lg border border-gold/40 bg-gold-soft px-4 py-3">
                  <p className="text-xs text-muted-foreground">
                    {t("dealBox.missing", { count: dossier.missing.length })}
                  </p>
                  <ul className="mt-2 space-y-1">
                    {dossier.missing.map((type) => (
                      <li key={type} className="text-xs font-medium">
                        · {t(`contrats.type.${type}`)}
                      </li>
                    ))}
                  </ul>
                  {dossier.canDraft && (
                    <Button
                      variant="gold"
                      size="sm"
                      className="mt-3"
                      disabled={drafting}
                      onClick={() => {
                        setDrafting(true);
                        void draftContractsFn({ data: { dealId: dossier.deal!.id } })
                          .then(() => router.invalidate())
                          .finally(() => setDrafting(false));
                      }}
                    >
                      {t("contrats.draft")} ({dossier.missing.length})
                    </Button>
                  )}
                </div>
              )}
            </section>
          )}

          {/* Shown ONLY for a failed collection — never for a search that ran
              and honestly found nobody, which is an answer and would cost the
              same money to be told again. */}
          {demande.researchFailed && (
            <section className="card-surface border-l-4 border-l-destructive p-6">
              <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3">
                <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
                <div className="min-w-0">
                  <h2 className="text-base font-semibold">{t("detail.researchFailedTitle")}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t("detail.researchFailedBody")}
                  </p>
                  {demande.canRerunResearch && (
                    <Button
                      variant="gold"
                      size="sm"
                      className="mt-4"
                      disabled={rerunning}
                      onClick={() => void rerunResearch()}
                    >
                      <RefreshCw className={cn("size-4", rerunning && "animate-spin")} />
                      {rerunning ? t("detail.rerunRunning") : t("detail.rerunResearch")}
                    </Button>
                  )}
                  {rerunRefused && (
                    <p className="mt-3 text-xs text-muted-foreground">{t("detail.rerunRefused")}</p>
                  )}
                </div>
              </div>
            </section>
          )}

          {shortlist && (
            <ShortlistPanel shortlist={shortlist} onChanged={() => void router.invalidate()} />
          )}

          {rfq && (
            <RfqPanel requestId={demande.id} rfq={rfq} onChanged={() => void router.invalidate()} />
          )}

          {ranking && (
            <OfferRankingPanel ranking={ranking} onChanged={() => void router.invalidate()} />
          )}

          {pack && (
            <DecisionPackPanel
              data={pack}
              me={session?.user.id ?? null}
              onChanged={() => void router.invalidate()}
            />
          )}

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

              {/* P2 — the buyer picks who OSI approaches. Hidden for a viewer
                  seat and on a foreign dossier (canEdit covers both). */}
              {demande.canEdit && demande.quotesPlanRequired && (
                /* Soumissions are a paid feature (owner 2026-09-14). The plan
                   refuses before the buyer picks anyone, and the way out is
                   named: change the plan. The server fn refuses too — this
                   only spares the buyer a dead click. */
                <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-lg border border-gold/40 bg-gold-soft px-4 py-3">
                  <p className="min-w-0 text-xs text-foreground">
                    {t("soumissions.planRequired", { plan: demande.planName })}
                  </p>
                  <Link
                    to="/parametres"
                    className="inline-flex h-8 shrink-0 items-center rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90"
                  >
                    {t("soumissions.planRequiredCta")}
                  </Link>
                </div>
              )}
              {demande.canEdit && !demande.quotesPlanRequired && (
                <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-lg border border-border bg-secondary/40 px-4 py-3">
                  <p className="min-w-0 text-xs text-muted-foreground">
                    {askOutcome ?? t("soumissions.askHint")}
                  </p>
                  <Button
                    variant="gold"
                    size="sm"
                    disabled={picked.length === 0 || asking}
                    onClick={() => void askForQuotes()}
                  >
                    {t("soumissions.askSelected")}
                    {picked.length > 0 ? ` (${picked.length})` : ""}
                  </Button>
                </div>
              )}

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
                      {demande.canEdit && !demande.quotesPlanRequired ? (
                        <input
                          type="checkbox"
                          aria-label={m.supplier.name}
                          checked={picked.includes(m.supplier.id)}
                          onChange={() => togglePick(m.supplier.id)}
                          className="size-4 cursor-pointer accent-gold"
                        />
                      ) : (
                        m.rank
                      )}
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

          {spec && (
            <SpecPanel
              requestId={demande.id}
              initial={spec}
              validated={demande.validated}
              // How offers are compared only concerns a workspace whose plan
              // asks for offers at all.
              showOfferWeights={!demande.quotesPlanRequired}
            />
          )}

          {/* The clarification (V18) is platform-gated (AI_CHAT): when off,
              the whole section is hidden, transcripts included. Shown on a
              draft, where it can be used, and afterwards only if it was —
              an empty panel on a launched request offers nothing. */}
          {demande.aiChatEnabled &&
            (beforeLaunch(demande.status) || demande.messages.length > 0) && (
              <RequestChat
                requestId={demande.id}
                messages={demande.messages}
                canAsk={demande.canEdit && beforeLaunch(demande.status)}
                canResolve={demande.canEdit && criteriaEditable(demande.status)}
                frozen={!criteriaEditable(demande.status)}
                turnsLeft={demande.clarifyTurnsLeft}
              />
            )}
        </div>
      </div>
    </div>
  );
}
