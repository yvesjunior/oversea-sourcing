// The release queue (Phase V · V11) — every Decision Pack awaiting a decision,
// the one that has waited longest first, with whose desk it is on.
//
// The diagram's step 10 happens here: nothing reaches a buyer until a person
// has looked. So the two things this page must make impossible to miss are a
// pack that has waited too long, and a pack nobody has taken. The four
// actions themselves live on the dossier, beside the offers they are about;
// this page is the desk, and its one act is taking a pack onto it.
//
// Second tab (V14): « Ce que la revue a changé » — what that looking has
// changed, and what it cost the buyer in waiting. It is the evidence the
// automatic release mode waits for, read from kept rows and no log.

import { useState } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ChevronRight, PackageCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requirePlatformFeature } from "@/lib/auth-guard";
import { formatDayTime } from "@/lib/instant";
import {
  assignPackFn,
  getPackQueueFn,
  getPackReviewReportFn,
  type PackQueueData,
  type PackReviewReportData,
  type QueuedPack,
} from "@/lib/pack-fns";
import {
  formatWait,
  PACK_OUTCOMES,
  REPORT_PERIODS,
  type ReportPeriod,
} from "@/lib/pack-review-report";
import { cn } from "@/lib/utils";

/** The period the report opens on. A quarter: long enough to hold a few
 *  packs while volumes are small, short enough to still describe today. */
const DEFAULT_PERIOD: ReportPeriod = 90;

type PacksPageData = PackQueueData & { report: PackReviewReportData | null };

export const Route = createFileRoute("/interne/packs")({
  beforeLoad: ({ context }) => requirePlatformFeature(context.session, "deals"),
  head: () => ({
    meta: [{ title: "Decision Packs | OSI" }, { name: "robots", content: "noindex" }],
  }),
  loader: async (): Promise<PacksPageData> => {
    const [queue, report] = await Promise.all([
      getPackQueueFn(),
      getPackReviewReportFn({ data: { days: DEFAULT_PERIOD } }),
    ]);
    return { ...(queue ?? { packs: [], me: "", releaseMode: "manual" as const }), report };
  },
  component: PacksPage,
});

/** "3 h", "2 j 4 h" — how long a pack has waited on a person. Rendered from
 *  the loader's instant, so the server and the browser print the same text. */
function waited(since: string | null, now: number): string {
  if (!since) return "—";
  const hours = Math.max(0, Math.floor((now - new Date(since).getTime()) / 3_600_000));
  return hours < 24 ? `${hours} h` : `${Math.floor(hours / 24)} j ${hours % 24} h`;
}

function PackRowView({
  pack,
  me,
  now,
  onChanged,
}: {
  pack: QueuedPack;
  me: string;
  now: number;
  onChanged: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState(false);
  const mine = pack.assignedTo === me;

  const assign = async (take: boolean) => {
    setBusy(true);
    try {
      await assignPackFn({ data: { packId: pack.packId, take } });
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <Link
          to="/demandes/$id"
          params={{ id: pack.requestId }}
          className="group flex items-center gap-2 text-sm font-semibold transition-colors hover:text-gold"
        >
          <span className="truncate">
            #{pack.requestId} — {pack.requestTitle}
          </span>
          <ChevronRight className="size-4 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
        </Link>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {pack.organizationName} ·{" "}
          {pack.items === 0 ? (
            <span className="font-medium text-warning">{t("packQueue.empty")}</span>
          ) : (
            t("packQueue.items", { count: pack.items })
          )}
        </p>
        <p className="mt-1 text-xs">
          {pack.state === "review" ? (
            <>
              <span className="font-semibold tabular-nums">
                {t("packQueue.waiting", { age: waited(pack.waitingSince, now) })}
              </span>
              {pack.waitingSince && (
                <span className="text-muted-foreground">
                  {" "}
                  ·{" "}
                  {t("packQueue.since", { date: formatDayTime(pack.waitingSince, i18n.language) })}
                </span>
              )}
            </>
          ) : (
            <span className="text-muted-foreground">{t("packQueue.relaunched")}</span>
          )}
        </p>
      </div>
      <div className="flex items-center gap-3">
        {pack.assignedToName ? (
          <span className="text-xs">{t("pack.onDeskOf", { name: pack.assignedToName })}</span>
        ) : (
          // An unassigned pack must LOOK unassigned — it is the one nobody
          // is going to open.
          <span className="flex items-center gap-1.5 text-xs font-medium text-warning">
            <AlertTriangle className="size-3.5" />
            {t("pack.unassigned")}
          </span>
        )}
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void assign(!mine)}>
          {t(mine ? "pack.putBackAction" : "pack.take")}
        </Button>
      </div>
    </li>
  );
}

function Figure({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ReviewReport({ initial }: { initial: PackReviewReportData | null }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language.startsWith("en") ? "en" : "fr";
  const [report, setReport] = useState(initial);
  const [busy, setBusy] = useState(false);

  const load = async (days: ReportPeriod) => {
    setBusy(true);
    try {
      setReport(await getPackReviewReportFn({ data: { days } }));
    } finally {
      setBusy(false);
    }
  };

  if (!report) return null;
  const { outcomes, waits } = report;
  const decided = report.packs.length;

  return (
    <div className={cn("space-y-6", busy && "opacity-60")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-sm text-muted-foreground">{t("packReport.subtitle")}</p>
        <div className="flex gap-1" role="group" aria-label={t("packReport.period")}>
          {REPORT_PERIODS.map((days) => (
            <Button
              key={days}
              size="sm"
              variant={report.days === days ? "default" : "outline"}
              disabled={busy}
              aria-pressed={report.days === days}
              onClick={() => void load(days)}
            >
              {t(`packReport.periods.${days}`)}
            </Button>
          ))}
        </div>
      </div>

      <section className="card-surface p-5">
        <h2 className="text-base font-bold">{t("packReport.outcomesTitle")}</h2>
        {decided === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t("packReport.none")}</p>
        ) : (
          <>
            {/* The answer first, as a sentence: it is the one line the owner
                reads before deciding anything about the release mode. */}
            <p className="mt-2 text-sm">
              {report.reviewed === 0
                ? t("packReport.noneReviewed")
                : t("packReport.answer", {
                    changed: report.changed,
                    count: report.reviewed,
                    percent: Math.round((report.changed / report.reviewed) * 100),
                  })}
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {PACK_OUTCOMES.map((outcome) => (
                <Figure
                  key={outcome}
                  label={t(`packReport.outcome.${outcome}`)}
                  value={String(outcomes[outcome])}
                  hint={t(`packReport.outcomeHint.${outcome}`)}
                />
              ))}
            </div>
          </>
        )}
        {(report.relaunchesSent > 0 || report.heldForPerson > 0) && (
          <p className="mt-3 text-xs text-muted-foreground">
            {report.relaunchesSent > 0 &&
              t("packReport.relaunchesSent", { count: report.relaunchesSent })}
            {report.relaunchesSent > 0 && report.heldForPerson > 0 && " "}
            {report.heldForPerson > 0 &&
              t("packReport.heldForPerson", { count: report.heldForPerson })}
          </p>
        )}
      </section>

      <section className="card-surface p-5">
        <h2 className="text-base font-bold">{t("packReport.waitsTitle")}</h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("packReport.waitsHint")}</p>
        {waits ? (
          <>
            <div className="mt-4 grid items-stretch gap-2 sm:grid-cols-[1fr_auto_1fr_auto_1fr]">
              <Figure
                label={t("packReport.window")}
                value={formatWait(waits.windowMs, lang)}
                hint={t("packReport.windowHint")}
              />
              <span className="hidden self-center text-xl text-muted-foreground sm:block">+</span>
              <Figure
                label={t("packReport.desk")}
                value={formatWait(waits.deskMs, lang)}
                hint={t("packReport.deskHint")}
              />
              <span className="hidden self-center text-xl text-muted-foreground sm:block">=</span>
              <Figure
                label={t("packReport.total")}
                value={formatWait(waits.totalMs, lang)}
                hint={t("packReport.totalHint", {
                  count: waits.packs,
                  longest: formatWait(waits.longestMs, lang),
                })}
              />
            </div>
          </>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">{t("packReport.noWaits")}</p>
        )}

        {decided > 0 && (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="py-2 pr-3 font-medium">{t("packReport.col.request")}</th>
                  <th className="py-2 pr-3 font-medium">{t("packReport.col.outcome")}</th>
                  <th className="py-2 pr-3 font-medium">{t("packReport.col.decided")}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t("packReport.window")}</th>
                  <th className="py-2 pr-3 text-right font-medium">{t("packReport.desk")}</th>
                  <th className="py-2 text-right font-medium">{t("packReport.total")}</th>
                </tr>
              </thead>
              <tbody>
                {report.packs.map((pack) => (
                  <tr key={pack.packId} className="border-b border-border/60 last:border-0">
                    <td className="max-w-[260px] py-2 pr-3">
                      <Link
                        to="/demandes/$id"
                        params={{ id: pack.requestId }}
                        className="block truncate font-medium hover:text-gold"
                      >
                        #{pack.requestId} — {pack.requestTitle}
                      </Link>
                      <span className="block truncate text-muted-foreground">
                        {pack.organizationName}
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      {t(`packReport.outcomeOne.${pack.outcome}`)}
                      {pack.relaunches > 0 && (
                        <span className="text-muted-foreground">
                          {" · "}
                          {t("packReport.relaunches", { count: pack.relaunches })}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 tabular-nums">
                      {formatDayTime(pack.decidedAt, i18n.language)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {formatWait(pack.windowMs, lang)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {formatWait(pack.deskMs, lang)}
                    </td>
                    <td className="py-2 text-right font-semibold tabular-nums">
                      {formatWait(pack.totalMs, lang)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card-surface p-5">
        <h2 className="text-base font-bold">
          {t("packReport.earlyTitle", { count: report.earlyCloses.length })}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">{t("packReport.earlyHint")}</p>
        {report.earlyCloses.length > 0 && (
          <ul className="mt-3 space-y-2">
            {report.earlyCloses.map((close) => (
              <li
                key={`${close.requestId}-${close.roundNo}`}
                className="rounded-lg border border-border p-3 text-xs"
              >
                <Link
                  to="/demandes/$id"
                  params={{ id: close.requestId }}
                  className="font-medium hover:text-gold"
                >
                  #{close.requestId} — {close.requestTitle}
                </Link>
                <span className="text-muted-foreground">
                  {" · "}
                  {t("pack.round", { no: close.roundNo })}
                  {" · "}
                  {formatDayTime(close.closedAt, i18n.language)}
                  {close.closedByName && ` · ${close.closedByName}`}
                </span>
                {close.note && <p className="mt-1 whitespace-pre-wrap">« {close.note} »</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function PacksPage() {
  const { t } = useTranslation();
  const { report, releaseMode } = Route.useLoaderData();
  return (
    <div className="space-y-6 pt-6">
      <header>
        <h1 className="font-display text-2xl font-semibold">{t("packQueue.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("packQueue.subtitle")}</p>
        {/* The mode in force, on the page where its effect shows: in
            `automatic` an empty queue does not mean nothing was sent. */}
        <p
          className={cn(
            "mt-1 text-xs",
            releaseMode === "automatic" ? "font-medium text-warning" : "text-muted-foreground",
          )}
        >
          {t(`packQueue.mode.${releaseMode}`)}
        </p>
      </header>
      <Tabs defaultValue="file">
        <TabsList>
          <TabsTrigger value="file" className="py-1">
            {t("packQueue.tabQueue")}
          </TabsTrigger>
          <TabsTrigger value="revue" className="py-1">
            {t("packReport.tab")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="file" className="mt-3">
          <PackQueue />
        </TabsContent>
        <TabsContent value="revue" className="mt-3">
          <ReviewReport initial={report} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function PackQueue() {
  const { t } = useTranslation();
  const router = useRouter();
  const { packs, me } = Route.useLoaderData();
  // One instant for the whole render, taken once per load.
  const [now] = useState(() => Date.now());
  const refresh = () => void router.invalidate();
  const review = packs.filter((pack) => pack.state === "review");
  const relaunched = packs.filter((pack) => pack.state === "relaunched");

  return (
    <div className="space-y-6">
      <section className="card-surface p-5">
        <h2 className="mb-3 text-base font-bold">
          {t("packQueue.review", { count: review.length })}
        </h2>
        {review.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center">
            <PackageCheck className="mx-auto size-8 text-muted-foreground/50" />
            <p className="mt-3 text-sm text-muted-foreground">{t("packQueue.none")}</p>
          </div>
        ) : (
          <ul className="space-y-2">
            {review.map((pack) => (
              <PackRowView key={pack.packId} pack={pack} me={me} now={now} onChanged={refresh} />
            ))}
          </ul>
        )}
      </section>

      {relaunched.length > 0 && (
        <section className={cn("card-surface p-5")}>
          <h2 className="mb-1 text-base font-bold">
            {t("packQueue.relaunchedTitle", { count: relaunched.length })}
          </h2>
          <p className="mb-3 text-xs text-muted-foreground">{t("packQueue.relaunchedHint")}</p>
          <ul className="space-y-2">
            {relaunched.map((pack) => (
              <PackRowView key={pack.packId} pack={pack} me={me} now={now} onChanged={refresh} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
