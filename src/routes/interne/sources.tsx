// Data-source catalogue (C1 + Phase D, staff surface) — enable/disable
// sources, health from real source_run outcomes, full-pull "Mettre à jour"
// on static sources, and the per-source store browser: raw candidate records
// (promoted or not), bans (per-record and global), owner-only store wipe.

import { useCallback, useEffect, useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CountryTag } from "@/components/osi/CountryTag";
import { hasSessionFeature, requirePlatformFeature } from "@/lib/auth-guard";
import { isDynamicSource } from "@/lib/source-kind";
import {
  getSourceAdminFn,
  getSourceDetailFn,
  setRecordStatusFn,
  setSupplierBanFn,
  STORE_PAGE_SIZE_DEFAULT,
  STORE_PAGE_SIZES,
  toggleSourceFn,
  triggerSourceRefreshFn,
  wipeSourceStoreFn,
  type SourceCatalogueView,
  type SourceDetailView,
  type SourceRunView,
} from "@/lib/source-admin-fns";
import { cn } from "@/lib/utils";
import { formatDay, formatShortDateTime } from "@/lib/instant";

export const Route = createFileRoute("/interne/sources")({
  beforeLoad: ({ context }) => requirePlatformFeature(context.session, "sources"),
  head: () => ({ meta: [{ title: "Sources | OSI" }] }),
  loader: async () => await getSourceAdminFn(),
  component: Sources,
});

/** How often the screen re-reads while a collection is running. */
const POLL_MS = 5_000;

/** Active-tab styling shared with Paramètres/Abonnements. */
const TAB_TRIGGER =
  "py-1 data-[state=active]:bg-gold-gradient data-[state=active]:text-gold-foreground data-[state=active]:shadow-gold";

function RunPill({ status }: { status: SourceRunView["status"] }) {
  const { t } = useTranslation();
  const styles: Record<SourceRunView["status"], string> = {
    running: "bg-secondary text-muted-foreground animate-pulse",
    succeeded: "bg-emerald-500/15 text-emerald-600",
    failed: "bg-destructive/15 text-destructive",
  };
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", styles[status])}>
      {t(`sourcesAdmin.runStatus.${status}`)}
    </span>
  );
}

/** Ban with a mandatory reason, unban in one click — one control for both the
 *  per-source and the global level. */
function BanControl({
  banned,
  banLabel,
  unbanLabel,
  onBan,
  onUnban,
}: {
  banned: boolean;
  banLabel: string;
  unbanLabel: string;
  onBan: (reason: string) => Promise<void>;
  onUnban: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      setEditing(false);
      setReason("");
    } finally {
      setBusy(false);
    }
  };

  if (banned) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2 text-xs"
        disabled={busy}
        onClick={() => void run(onUnban)}
      >
        {unbanLabel}
      </Button>
    );
  }
  if (!editing) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2 text-xs text-destructive"
        onClick={() => setEditing(true)}
      >
        {banLabel}
      </Button>
    );
  }
  return (
    <span className="flex items-center gap-1">
      <Input
        autoFocus
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={t("sourcesAdmin.banReason")}
        className="h-7 w-44 text-xs"
      />
      <Button
        size="sm"
        variant="destructive"
        className="h-7 px-2 text-xs"
        disabled={busy || reason.trim().length < 3}
        onClick={() => void run(() => onBan(reason.trim()))}
      >
        {t("sourcesAdmin.confirm")}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-xs"
        onClick={() => setEditing(false)}
      >
        {t("sourcesAdmin.cancel")}
      </Button>
    </span>
  );
}

/** Full pull for STATIC sources (settled 2026-08-24) — no scope: the
 *  connector collects everything, dedup makes each trigger idempotent.
 *  File-fed sources (registry-qc) take the staff-downloaded archive here:
 *  it streams to the uploads volume, the run consumes and deletes it. */
function RefreshForm({ source, onDone }: { source: SourceCatalogueView; onDone: () => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  const launch = async () => {
    setBusy(true);
    setError(null);
    try {
      let fileKey: string | undefined;
      if (source.requiresFile) {
        if (!file) {
          setError(t("sourcesAdmin.refreshError.file_required"));
          return;
        }
        setUploading(true);
        try {
          const response = await fetch(
            `/api/source-upload?filename=${encodeURIComponent(file.name)}`,
            { method: "PUT", body: file },
          );
          if (!response.ok) {
            setError(t("sourcesAdmin.uploadFailed"));
            return;
          }
          fileKey = ((await response.json()) as { key: string }).key;
        } finally {
          setUploading(false);
        }
      }
      const result = await triggerSourceRefreshFn({
        data: { dataSourceId: source.id, ...(fileKey ? { fileKey } : {}) },
      });
      if (!result.ok) {
        setError(t(`sourcesAdmin.refreshError.${result.error ?? "unknown"}`));
        return;
      }
      setFile(null);
      onDone();
    } finally {
      setBusy(false);
    }
  };

  const running = source.runningRuns > 0;

  return (
    <div className="rounded-lg bg-secondary/60 p-3">
      <p className="text-xs font-semibold">{t("sourcesAdmin.refreshTitle")}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        {t(source.requiresFile ? "sourcesAdmin.refreshFileHint" : "sourcesAdmin.refreshHint")}
        {source.requiresFile && source.downloadUrl && (
          <>
            {" "}
            <a
              href={source.downloadUrl}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-gold underline-offset-2 hover:underline"
            >
              {t("sourcesAdmin.downloadLink")} ↗
            </a>
          </>
        )}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {source.requiresFile && (
          <input
            type="file"
            accept=".zip"
            aria-label={t("sourcesAdmin.uploadLabel")}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="max-w-xs text-xs text-muted-foreground file:mr-2 file:rounded-md file:border file:border-input file:bg-background file:px-2 file:py-1 file:text-xs"
          />
        )}
        <Button
          size="sm"
          disabled={busy || running || (source.requiresFile && !file)}
          onClick={() => void launch()}
        >
          {uploading
            ? t("sourcesAdmin.uploading")
            : running
              ? t("sourcesAdmin.refreshRunning")
              : t("sourcesAdmin.refresh")}
        </Button>
      </div>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

function RunsTable({ runs }: { runs: SourceRunView[] }) {
  const { t, i18n } = useTranslation();
  const stamp = (iso: string) => formatShortDateTime(iso, i18n.language);

  if (runs.length === 0) {
    return <p className="text-xs text-muted-foreground">{t("sourcesAdmin.noRuns")}</p>;
  }
  return (
    // ~3 rows visible; the rest slide in on scroll.
    <div className="max-h-40 overflow-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="sticky top-0 bg-card">
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="pb-2 pr-4 font-medium">{t("sourcesAdmin.runWhen")}</th>
            <th className="pb-2 pr-4 font-medium">{t("sourcesAdmin.runTrigger")}</th>
            <th className="pb-2 pr-4 font-medium">{t("sourcesAdmin.runScope")}</th>
            <th className="pb-2 pr-4 font-medium">{t("sourcesAdmin.runStatusHead")}</th>
            <th className="pb-2 pr-4 font-medium">{t("sourcesAdmin.runResults")}</th>
            <th className="pb-2 font-medium">{t("sourcesAdmin.runBy")}</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id} className="border-b border-border/60">
              <td className="py-2 pr-4 text-xs text-muted-foreground">{stamp(run.createdAt)}</td>
              <td className="py-2 pr-4 text-xs">
                {run.trigger === "admin"
                  ? t("sourcesAdmin.triggerAdmin")
                  : t("sourcesAdmin.triggerRequest", { id: run.requestId ?? "?" })}
              </td>
              <td className="py-2 pr-4 text-xs text-muted-foreground">
                {run.action === "wipe"
                  ? t("sourcesAdmin.wipeRun", { count: run.deleted ?? 0 })
                  : run.trigger === "admin"
                    ? t("sourcesAdmin.fullPull")
                    : "—"}
              </td>
              <td className="py-2 pr-4">
                <RunPill status={run.status} />
                {run.error && (
                  <p
                    className="mt-0.5 max-w-[280px] truncate text-[10px] text-destructive"
                    title={run.error}
                  >
                    {run.error}
                  </p>
                )}
              </td>
              <td className="py-2 pr-4 text-xs tabular-nums text-muted-foreground">
                {run.status === "running"
                  ? "…"
                  : t("sourcesAdmin.runCounts", {
                      found: run.candidatesFound,
                      added: run.suppliersAdded,
                    })}
              </td>
              <td className="py-2 text-xs text-muted-foreground">{run.triggeredByName ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StoreTable({ detail, onChanged }: { detail: SourceDetailView; onChanged: () => void }) {
  const { t, i18n } = useTranslation();
  const stamp = (iso: string) => formatDay(iso, i18n.language);

  if (detail.records.length === 0) {
    return <p className="text-xs text-muted-foreground">{t("sourcesAdmin.emptyStore")}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="pb-2 pr-4 font-medium">{t("sourcesAdmin.supplier")}</th>
            <th className="pb-2 pr-4 font-medium">{t("sourcesAdmin.supplierCountry")}</th>
            <th className="pb-2 pr-4 font-medium">{t("sourcesAdmin.confidence")}</th>
            <th className="pb-2 pr-4 font-medium">{t("sourcesAdmin.seen")}</th>
            <th className="pb-2 pr-4 font-medium">{t("sourcesAdmin.sourceBan")}</th>
            <th className="pb-2 font-medium">{t("sourcesAdmin.globalBan")}</th>
          </tr>
        </thead>
        <tbody>
          {detail.records.map((m) => (
            <tr
              key={m.recordId}
              className={cn(
                "border-b border-border/60",
                (m.status === "banned" || m.globallyBanned) && "opacity-60",
              )}
            >
              <td className="py-2.5 pr-4">
                <p className="font-medium">
                  {m.name}
                  {/* Promoted = a supplier row exists; a bare record is only a
                      candidate and disappears with a store wipe. */}
                  {m.supplierId && (
                    <span className="ml-2 rounded-full bg-gold-gradient px-2 py-0.5 text-[10px] font-semibold text-gold-foreground">
                      {t("sourcesAdmin.promoted")}
                    </span>
                  )}
                  {m.globallyBanned && (
                    <span
                      className="ml-2 rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-semibold text-destructive"
                      title={m.globalBanReason ?? undefined}
                    >
                      {t("sourcesAdmin.globallyBanned")}
                    </span>
                  )}
                </p>
                {m.website && (
                  <a
                    href={m.website}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                  >
                    {m.website}
                  </a>
                )}
              </td>
              <td className="py-2.5 pr-4">
                <CountryTag code={m.countryCode} />
              </td>
              <td className="py-2.5 pr-4 text-xs tabular-nums text-muted-foreground">
                {m.confidenceScore}
              </td>
              <td className="py-2.5 pr-4 text-xs text-muted-foreground">
                {t("sourcesAdmin.seenRange", {
                  first: stamp(m.firstSeenAt),
                  last: stamp(m.lastSeenAt),
                })}
              </td>
              <td className="py-2.5 pr-4">
                {m.status === "banned" && (
                  <p
                    className="mb-1 max-w-[220px] truncate text-[10px] text-destructive"
                    title={`${m.bannedReason ?? ""}${m.bannedByName ? ` — ${m.bannedByName}` : ""}`}
                  >
                    {m.bannedReason}
                    {m.bannedByName ? ` — ${m.bannedByName}` : ""}
                  </p>
                )}
                <BanControl
                  banned={m.status === "banned"}
                  banLabel={t("sourcesAdmin.ban")}
                  unbanLabel={t("sourcesAdmin.unban")}
                  onBan={async (reason) => {
                    await setRecordStatusFn({
                      data: { action: "ban", recordId: m.recordId, reason },
                    });
                    onChanged();
                  }}
                  onUnban={async () => {
                    await setRecordStatusFn({
                      data: { action: "unban", recordId: m.recordId },
                    });
                    onChanged();
                  }}
                />
              </td>
              <td className="py-2.5">
                {/* Only promoted records have a supplier to ban globally. */}
                {m.supplierId ? (
                  <BanControl
                    banned={m.globallyBanned}
                    banLabel={t("sourcesAdmin.banGlobal")}
                    unbanLabel={t("sourcesAdmin.unbanGlobal")}
                    onBan={async (reason) => {
                      await setSupplierBanFn({
                        data: { action: "ban", supplierId: m.supplierId!, reason },
                      });
                      onChanged();
                    }}
                    onUnban={async () => {
                      await setSupplierBanFn({
                        data: { action: "unban", supplierId: m.supplierId! },
                      });
                      onChanged();
                    }}
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Owner-only store wipe (Phase D) — two-step confirm; promoted suppliers,
 *  matches and requests survive by construction. */
function WipeButton({ source, onDone }: { source: SourceCatalogueView; onDone: () => void }) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const wipe = async () => {
    setBusy(true);
    try {
      await wipeSourceStoreFn({ data: { dataSourceId: source.id } });
      setConfirming(false);
      onDone();
    } finally {
      setBusy(false);
    }
  };

  if (!confirming) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="h-7 px-2 text-xs text-destructive"
        onClick={() => setConfirming(true)}
      >
        {t("sourcesAdmin.wipe")}
      </Button>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <span className="text-xs text-destructive">
        {t("sourcesAdmin.wipeConfirm", { count: source.storeActive + source.storeBanned })}
      </span>
      <Button
        size="sm"
        variant="destructive"
        className="h-7 px-2 text-xs"
        disabled={busy}
        onClick={() => void wipe()}
      >
        {t("sourcesAdmin.confirm")}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 px-2 text-xs"
        onClick={() => setConfirming(false)}
      >
        {t("sourcesAdmin.cancel")}
      </Button>
    </span>
  );
}

function Sources() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { session } = Route.useRouteContext();
  const sources = Route.useLoaderData();
  // Search sources first, then verification — the tab groups follow.
  const orderedSources = [
    ...sources.filter((s) => s.role === "discovery"),
    ...sources.filter((s) => s.role !== "discovery"),
  ];
  const canToggle = hasSessionFeature(session, "sources.toggle");
  const canWipe = hasSessionFeature(session, "sources.wipe");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SourceDetailView | null>(null);
  // Store browser: committed search + page + page size, reset on tab change.
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(STORE_PAGE_SIZE_DEFAULT);

  const anyRunning = sources.some((s) => s.runningRuns > 0);

  const loadDetail = useCallback(
    async (dataSourceId: string, term: string, pageIndex: number, size: number) => {
      setDetail(
        await getSourceDetailFn({
          data: {
            dataSourceId,
            ...(term ? { search: term } : {}),
            ...(pageIndex > 0 ? { page: pageIndex } : {}),
            ...(size !== STORE_PAGE_SIZE_DEFAULT ? { pageSize: size } : {}),
          },
        }),
      );
    },
    [],
  );

  const refresh = useCallback(() => {
    void router.invalidate();
    if (selectedId) void loadDetail(selectedId, search, page, pageSize);
  }, [router, selectedId, search, page, pageSize, loadDetail]);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId, search, page, pageSize);
    else setDetail(null);
  }, [selectedId, search, page, pageSize, loadDetail]);

  const selectTab = (value: string) => {
    setSelectedId(value);
    setSearchInput("");
    setSearch("");
    setPage(0);
  };

  const commitSearch = () => {
    setSearch(searchInput.trim());
    setPage(0);
  };

  // A collection takes tens of seconds — keep the screen honest while one runs
  // instead of asking the operator to hammer reload.
  useEffect(() => {
    if (!anyRunning) return;
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [anyRunning, refresh]);

  // Was guarded behind a mounted flag because the container renders UTC and
  // the browser did not — src/lib/instant.ts pins the zone on both sides now,
  // so this can be server-rendered like everything else.
  const stamp = (iso: string) => formatShortDateTime(iso, i18n.language);

  return (
    <div className="space-y-6 pt-6">
      <header>
        <h1 className="font-display text-2xl font-semibold">{t("sourcesAdmin.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("sourcesAdmin.subtitle")}</p>
      </header>

      {/* One tab per catalogue source, grouped by CATEGORY (owner request
          2026-08-28): sources for SEARCH (discovery role — feed matching)
          and sources for VERIFICATION (registries — per-candidate checks,
          never matched). The old overview table's controls live in each
          tab's panel header. */}
      <Tabs value={selectedId ?? orderedSources[0]?.id ?? ""} onValueChange={selectTab}>
        <TabsList className="h-auto flex-wrap gap-1">
          {(["discovery", "verification"] as const).map((role) => {
            const group = orderedSources.filter((s) => s.role === role);
            if (group.length === 0) return null;
            return (
              <span key={role} className="flex flex-wrap items-center gap-1">
                <span className="px-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {t(`sourcesAdmin.roles.${role}`)}
                </span>
                {group.map((source) => (
                  <TabsTrigger key={source.id} value={source.id} className={TAB_TRIGGER}>
                    {/* Names render through i18n by code; the DB name (French)
                        is the fallback for sources without a translation yet. */}
                    {t(`sourceNames.${source.code}`, { defaultValue: source.name })}
                    {source.runningRuns > 0 && (
                      <span className="ml-1.5 inline-block size-1.5 animate-pulse rounded-full bg-current" />
                    )}
                  </TabsTrigger>
                ))}
              </span>
            );
          })}
        </TabsList>

        {sources.map((source) => (
          <TabsContent key={source.id} value={source.id} className="mt-3">
            <section className="card-surface space-y-5 p-6">
              <header className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <code className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold">
                      {source.code}
                    </code>
                    {/* ADR-001 role — verification sources never feed matching. */}
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                        source.role === "verification"
                          ? "bg-secondary text-muted-foreground"
                          : "bg-gold-gradient text-gold-foreground",
                      )}
                    >
                      {t(`sourcesAdmin.roles.${source.role}`)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {t(`sourcesAdmin.types.${source.type}`)}
                      {source.countryCode ? ` · ${source.countryCode}` : ""}
                      {!source.hasConnector && ` · ${t("sourcesAdmin.storeOnly")}`}
                    </span>
                    {source.runningRuns > 0 ? (
                      <RunPill status="running" />
                    ) : source.lastRun ? (
                      <>
                        <RunPill status={source.lastRun.status} />
                        <span className="text-[10px] text-muted-foreground">
                          {stamp(source.lastRun.completedAt ?? source.lastRun.createdAt)}
                        </span>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {t("sourcesAdmin.neverRan")}
                      </span>
                    )}
                  </p>
                  <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                    {t("sourcesAdmin.storeCounts", {
                      active: source.storeActive,
                      fresh: source.storeFresh,
                    })}
                    {" · "}
                    {t("sourcesAdmin.storePromoted", { count: source.storePromoted })}
                    {source.storeBanned > 0 && (
                      <span className="text-destructive">
                        {" "}
                        {t("sourcesAdmin.storeBanned", { count: source.storeBanned })}
                      </span>
                    )}
                  </p>
                </div>
                <span className="flex items-center gap-3">
                  {/* Enable/disable follows the Rôles & accès matrix
                      (sources.toggle) — the ungranted see the state only. */}
                  {canToggle ? (
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      {t("sourcesAdmin.enabled")}
                      <Switch
                        checked={source.enabled}
                        aria-label={t("sourcesAdmin.enabled")}
                        onCheckedChange={(enabled) => {
                          void toggleSourceFn({ data: { id: source.id, enabled } }).then(refresh);
                        }}
                      />
                    </label>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {source.enabled ? t("sourcesAdmin.enabled") : t("sourcesAdmin.disabled")}
                    </span>
                  )}
                  {canWipe && (source.storeActive > 0 || source.storeBanned > 0) && (
                    <WipeButton source={source} onDone={refresh} />
                  )}
                </span>
              </header>

              {/* ADR-001: a verification source's store is a lookup table for
                  the per-candidate checks — refreshed on a slow cadence, never
                  matched, never visible to workspaces. */}
              {source.role === "verification" && (
                <p className="rounded-lg bg-secondary/60 p-3 text-xs text-muted-foreground">
                  {t("sourcesAdmin.verificationHint")}
                </p>
              )}

              {isDynamicSource(source.type) ? (
                <p className="rounded-lg bg-secondary/60 p-3 text-xs text-muted-foreground">
                  {t("sourcesAdmin.dynamicHint")}
                </p>
              ) : source.hasConnector ? (
                <RefreshForm source={source} onDone={refresh} />
              ) : (
                <p className="rounded-lg bg-secondary/60 p-3 text-xs text-muted-foreground">
                  {t("sourcesAdmin.storeOnlyHint")}
                </p>
              )}

              {/* Group: run history — 3 visible, the rest on scroll. */}
              <div className="rounded-xl border border-border/60 p-4">
                <h3 className="mb-2 text-sm font-semibold">{t("sourcesAdmin.runsTitle")}</h3>
                <RunsTable runs={source.id === selectedId ? (detail?.runs ?? []) : []} />
              </div>

              {/* Group: the store browser — search, page size, range. */}
              <div className="rounded-xl border border-border/60 p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">{t("sourcesAdmin.storeTitle")}</h3>
                  <span className="flex flex-wrap items-center gap-2">
                    <Input
                      value={source.id === selectedId ? searchInput : ""}
                      onChange={(e) => setSearchInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitSearch();
                      }}
                      placeholder={t("sourcesAdmin.searchPlaceholder")}
                      className="h-8 w-56 text-sm"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 px-3 text-xs"
                      onClick={commitSearch}
                    >
                      {t("sourcesAdmin.search")}
                    </Button>
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {t("sourcesAdmin.rowsPerPage")}
                      <select
                        value={pageSize}
                        onChange={(e) => {
                          setPageSize(Number(e.target.value));
                          setPage(0);
                        }}
                        className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                      >
                        {STORE_PAGE_SIZES.map((size) => (
                          <option key={size} value={size}>
                            {size}
                          </option>
                        ))}
                      </select>
                    </label>
                  </span>
                </div>
                {source.id === selectedId && detail ? (
                  <>
                    <StoreTable detail={detail} onChanged={refresh} />
                    {/* Range navigation — the registry store holds ~400k rows. */}
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {detail.total === 0
                          ? t("sourcesAdmin.rangeEmpty")
                          : t("sourcesAdmin.range", {
                              from: detail.page * pageSize + 1,
                              to: detail.page * pageSize + detail.records.length,
                              total: detail.total.toLocaleString(i18n.language),
                            })}
                      </span>
                      <span className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          disabled={page === 0}
                          onClick={() => setPage((p) => Math.max(0, p - 1))}
                        >
                          {t("sourcesAdmin.prev")}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 px-2 text-xs"
                          disabled={(detail.page + 1) * pageSize >= detail.total}
                          onClick={() => setPage((p) => p + 1)}
                        >
                          {t("sourcesAdmin.next")}
                        </Button>
                      </span>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">…</p>
                )}
              </div>
            </section>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
