// Data-source catalogue (C1, staff surface) — enable/disable sources, health
// from real source_run outcomes, scoped "Mettre à jour" collections, and the
// per-source store browser with bans (per-source and global).

import { useCallback, useEffect, useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CountryTag } from "@/components/osi/CountryTag";
import { requirePlatformFeature } from "@/lib/auth-guard";
import {
  getSourceAdminFn,
  getSourceDetailFn,
  setMembershipStatusFn,
  setSupplierBanFn,
  toggleSourceFn,
  triggerSourceRefreshFn,
  type SourceCatalogueView,
  type SourceDetailView,
  type SourceRunView,
} from "@/lib/source-admin-fns";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/interne/sources")({
  beforeLoad: ({ context }) => requirePlatformFeature(context.session, "sources"),
  head: () => ({ meta: [{ title: "Sources | OSI" }] }),
  loader: async () => await getSourceAdminFn(),
  component: Sources,
});

/** How often the screen re-reads while a collection is running. */
const POLL_MS = 5_000;

/** The catalogue is SSR'd and the container's timezone (UTC) is not the
 *  browser's — a server-formatted TIME never survives hydration. Timestamps
 *  render only after mount. */
function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

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

function RefreshForm({ source, onDone }: { source: SourceCatalogueView; onDone: () => void }) {
  const { t } = useTranslation();
  const [category, setCategory] = useState("");
  const [countryCode, setCountryCode] = useState(source.countryCode ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const launch = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await triggerSourceRefreshFn({
        data: {
          dataSourceId: source.id,
          category: category.trim(),
          ...(countryCode.trim() ? { countryCode: countryCode.trim().toUpperCase() } : {}),
        },
      });
      if (!result.ok) {
        setError(t(`sourcesAdmin.refreshError.${result.error ?? "unknown"}`));
        return;
      }
      setCategory("");
      onDone();
    } finally {
      setBusy(false);
    }
  };

  const running = source.runningRuns > 0;

  return (
    <div className="rounded-lg bg-secondary/60 p-3">
      <p className="text-xs font-semibold">{t("sourcesAdmin.refreshTitle")}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{t("sourcesAdmin.refreshHint")}</p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <div>
          <Label htmlFor="refresh-category" className="text-[11px] text-muted-foreground">
            {t("sourcesAdmin.category")}
          </Label>
          <Input
            id="refresh-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder={t("sourcesAdmin.categoryPlaceholder")}
            className="mt-1 h-8 w-64 text-sm"
          />
        </div>
        <div>
          <Label htmlFor="refresh-country" className="text-[11px] text-muted-foreground">
            {t("sourcesAdmin.country")}
          </Label>
          <Input
            id="refresh-country"
            value={countryCode}
            onChange={(e) => setCountryCode(e.target.value)}
            placeholder={t("sourcesAdmin.countryPlaceholder")}
            maxLength={2}
            className="mt-1 h-8 w-20 text-center text-sm uppercase"
          />
        </div>
        <Button
          size="sm"
          disabled={busy || running || category.trim().length < 2}
          onClick={() => void launch()}
        >
          {running ? t("sourcesAdmin.refreshRunning") : t("sourcesAdmin.refresh")}
        </Button>
      </div>
      {/* A collection is a Claude spend — say so before the click, not after. */}
      <p className="mt-2 text-[10px] text-muted-foreground">{t("sourcesAdmin.refreshCost")}</p>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  );
}

function RunsTable({ runs }: { runs: SourceRunView[] }) {
  const { t, i18n } = useTranslation();
  const stamp = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language, { dateStyle: "short", timeStyle: "short" });

  if (runs.length === 0) {
    return <p className="text-xs text-muted-foreground">{t("sourcesAdmin.noRuns")}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
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
                {run.category ?? "—"}
                {run.countryCode ? ` · ${run.countryCode}` : ""}
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
  const stamp = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

  if (detail.memberships.length === 0) {
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
          {detail.memberships.map((m) => (
            <tr
              key={m.membershipId}
              className={cn(
                "border-b border-border/60",
                (m.status === "banned" || m.globallyBanned) && "opacity-60",
              )}
            >
              <td className="py-2.5 pr-4">
                <p className="font-medium">
                  {m.name}
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
                    await setMembershipStatusFn({
                      data: { action: "ban", membershipId: m.membershipId, reason },
                    });
                    onChanged();
                  }}
                  onUnban={async () => {
                    await setMembershipStatusFn({
                      data: { action: "unban", membershipId: m.membershipId },
                    });
                    onChanged();
                  }}
                />
              </td>
              <td className="py-2.5">
                <BanControl
                  banned={m.globallyBanned}
                  banLabel={t("sourcesAdmin.banGlobal")}
                  unbanLabel={t("sourcesAdmin.unbanGlobal")}
                  onBan={async (reason) => {
                    await setSupplierBanFn({
                      data: { action: "ban", supplierId: m.supplierId, reason },
                    });
                    onChanged();
                  }}
                  onUnban={async () => {
                    await setSupplierBanFn({ data: { action: "unban", supplierId: m.supplierId } });
                    onChanged();
                  }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {detail.truncated && (
        <p className="mt-2 text-[10px] text-muted-foreground">{t("sourcesAdmin.truncated")}</p>
      )}
    </div>
  );
}

function Sources() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const sources = Route.useLoaderData();
  const [selectedId, setSelectedId] = useState<string | null>(sources[0]?.id ?? null);
  const [detail, setDetail] = useState<SourceDetailView | null>(null);

  const selected = sources.find((s) => s.id === selectedId) ?? null;
  const anyRunning = sources.some((s) => s.runningRuns > 0);

  const loadDetail = useCallback(async (dataSourceId: string) => {
    setDetail(await getSourceDetailFn({ data: { dataSourceId } }));
  }, []);

  const refresh = useCallback(() => {
    void router.invalidate();
    if (selectedId) void loadDetail(selectedId);
  }, [router, selectedId, loadDetail]);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId, loadDetail]);

  // A collection takes tens of seconds — keep the screen honest while one runs
  // instead of asking the operator to hammer reload.
  useEffect(() => {
    if (!anyRunning) return;
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [anyRunning, refresh]);

  const mounted = useMounted();
  const stamp = (iso: string) =>
    mounted
      ? new Date(iso).toLocaleString(i18n.language, { dateStyle: "short", timeStyle: "short" })
      : "…";

  return (
    <div className="space-y-6 pt-6">
      <header>
        <h1 className="font-display text-2xl font-semibold">{t("sourcesAdmin.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("sourcesAdmin.subtitle")}</p>
      </header>

      <section className="card-surface p-6">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="pb-2 pr-4 font-medium">{t("sourcesAdmin.source")}</th>
                <th className="pb-2 pr-4 font-medium">{t("sourcesAdmin.type")}</th>
                <th className="pb-2 pr-4 font-medium">{t("sourcesAdmin.store")}</th>
                <th className="pb-2 pr-4 font-medium">{t("sourcesAdmin.health")}</th>
                <th className="pb-2 pr-4 font-medium">{t("sourcesAdmin.enabled")}</th>
                <th className="pb-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {sources.map((source) => (
                <tr
                  key={source.id}
                  className={cn(
                    "border-b border-border/60",
                    source.id === selectedId && "bg-secondary/40",
                  )}
                >
                  <td className="py-2.5 pr-4">
                    <p className="font-medium">{source.name}</p>
                    <p className="text-xs text-muted-foreground">
                      <code className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold">
                        {source.code}
                      </code>
                      {!source.hasConnector && (
                        <span className="ml-2 text-[10px]">{t("sourcesAdmin.storeOnly")}</span>
                      )}
                    </p>
                  </td>
                  <td className="py-2.5 pr-4 text-xs text-muted-foreground">
                    {t(`sourcesAdmin.types.${source.type}`)}
                    {source.countryCode ? ` · ${source.countryCode}` : ""}
                  </td>
                  <td className="py-2.5 pr-4 text-xs tabular-nums text-muted-foreground">
                    {t("sourcesAdmin.storeCounts", {
                      active: source.storeActive,
                      fresh: source.storeFresh,
                    })}
                    {source.storeBanned > 0 && (
                      <span className="text-destructive">
                        {" "}
                        {t("sourcesAdmin.storeBanned", { count: source.storeBanned })}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4">
                    {source.runningRuns > 0 ? (
                      <RunPill status="running" />
                    ) : source.lastRun ? (
                      <span className="flex items-center gap-2">
                        <RunPill status={source.lastRun.status} />
                        <span className="text-[10px] text-muted-foreground">
                          {stamp(source.lastRun.completedAt ?? source.lastRun.createdAt)}
                        </span>
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {t("sourcesAdmin.neverRan")}
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 pr-4">
                    <Switch
                      checked={source.enabled}
                      aria-label={t("sourcesAdmin.enabled")}
                      onCheckedChange={(enabled) => {
                        void toggleSourceFn({ data: { id: source.id, enabled } }).then(refresh);
                      }}
                    />
                  </td>
                  <td className="py-2.5 text-right">
                    <Button
                      size="sm"
                      variant={source.id === selectedId ? "default" : "outline"}
                      className="h-7 px-3 text-xs"
                      onClick={() => setSelectedId(source.id)}
                    >
                      {t("sourcesAdmin.browse")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {selected && (
        <section className="card-surface space-y-5 p-6">
          <header className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-bold">{selected.name}</h2>
            <span className="text-xs text-muted-foreground">
              {t("sourcesAdmin.storeCounts", {
                active: selected.storeActive,
                fresh: selected.storeFresh,
              })}
            </span>
          </header>

          {selected.hasConnector ? (
            <RefreshForm source={selected} onDone={refresh} />
          ) : (
            <p className="rounded-lg bg-secondary/60 p-3 text-xs text-muted-foreground">
              {t("sourcesAdmin.storeOnlyHint")}
            </p>
          )}

          <div>
            <h3 className="mb-2 text-sm font-semibold">{t("sourcesAdmin.runsTitle")}</h3>
            <RunsTable runs={detail?.runs ?? []} />
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold">{t("sourcesAdmin.storeTitle")}</h3>
            {detail ? (
              <StoreTable detail={detail} onChanged={refresh} />
            ) : (
              <p className="text-xs text-muted-foreground">…</p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
