// The audit journal table (2026-08-27) — shared by the two surfaces the
// owner rule defines: /interne/logging (platform staff, every workspace,
// org filter shown) and Paramètres → Journal (an organisation's owner,
// server-forced to their own org — `showOrgFilter: false` only hides a
// control the server ignores anyway). Writes: src/server/audit.ts.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  AUDIT_PAGE_SIZE_DEFAULT,
  AUDIT_PAGE_SIZES,
  getAuditLogFn,
  type AuditLogData,
} from "@/lib/audit-fns";

export function AuditJournal({
  showOrgFilter,
  refreshTick = 0,
}: {
  /** Staff surface shows the workspace filter; the org-owner surface is
   *  server-scoped to one org, so the control would be a lie. */
  showOrgFilter: boolean;
  /** Bump to force a refetch (the purge button lives outside). */
  refreshTick?: number;
}) {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<AuditLogData | null>(null);
  const [orgFilter, setOrgFilter] = useState("");
  const [actorFilter, setActorFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState<number>(AUDIT_PAGE_SIZE_DEFAULT);

  useEffect(() => {
    // Guard against out-of-order responses: rapid filter/page changes fire
    // overlapping fetches, and a stale one landing last must not win.
    let cancelled = false;
    void getAuditLogFn({
      data: {
        ...(orgFilter ? { organizationId: orgFilter } : {}),
        ...(actorFilter ? { actorId: actorFilter } : {}),
        // The viewer's local day boundaries, sent as instants — "Du 27/08"
        // means THEIR 27th regardless of the server's timezone.
        ...(fromDate ? { from: new Date(`${fromDate}T00:00:00`).toISOString() } : {}),
        ...(toDate ? { to: new Date(`${toDate}T23:59:59.999`).toISOString() } : {}),
        ...(page > 0 ? { page } : {}),
        ...(pageSize !== AUDIT_PAGE_SIZE_DEFAULT ? { pageSize } : {}),
      },
    }).then((res) => {
      if (!cancelled) setData(res);
    });
    return () => {
      cancelled = true;
    };
  }, [orgFilter, actorFilter, fromDate, toDate, page, pageSize, refreshTick]);

  const stamp = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language, { dateStyle: "short", timeStyle: "short" });

  return (
    <section className="card-surface p-6">
      <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {t("auditAdmin.fromDate")}
          <input
            type="date"
            value={fromDate}
            max={toDate || undefined}
            onChange={(e) => {
              setFromDate(e.target.value);
              setPage(0);
            }}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {t("auditAdmin.toDate")}
          <input
            type="date"
            value={toDate}
            min={fromDate || undefined}
            onChange={(e) => {
              setToDate(e.target.value);
              setPage(0);
            }}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          />
        </label>
        {showOrgFilter && (
          <select
            aria-label={t("auditAdmin.filterOrg")}
            value={orgFilter}
            onChange={(e) => {
              // Cascading choice: workspace first, then one of ITS users.
              setOrgFilter(e.target.value);
              setActorFilter("");
              setPage(0);
            }}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          >
            <option value="">{t("auditAdmin.allOrgs")}</option>
            {(data?.filters.organizations ?? []).map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        )}
        <select
          aria-label={t("auditAdmin.filterActor")}
          value={actorFilter}
          onChange={(e) => {
            setActorFilter(e.target.value);
            setPage(0);
          }}
          className="h-8 rounded-md border border-input bg-background px-2 text-xs"
        >
          <option value="">{t("auditAdmin.allActors")}</option>
          {(data?.filters.actors ?? []).map((actor) => (
            <option key={actor.id} value={actor.id}>
              {actor.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {t("auditAdmin.rowsPerPage")}
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(0);
            }}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          >
            {AUDIT_PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!data || data.rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("auditAdmin.empty")}</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="pb-2 pr-4 font-medium">{t("auditAdmin.when")}</th>
                  <th className="pb-2 pr-4 font-medium">{t("auditAdmin.actor")}</th>
                  <th className="pb-2 pr-4 font-medium">{t("auditAdmin.action")}</th>
                  <th className="pb-2 pr-4 font-medium">{t("auditAdmin.target")}</th>
                  <th className="pb-2 font-medium">{t("auditAdmin.workspace")}</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.id} className="border-b border-border/60">
                    <td className="py-2 pr-4 text-xs text-muted-foreground">{stamp(row.at)}</td>
                    <td className="py-2 pr-4 text-xs">{row.actorName ?? "—"}</td>
                    <td className="py-2 pr-4">
                      <span
                        className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold"
                        title={row.detail ? JSON.stringify(row.detail) : undefined}
                      >
                        {t(`auditActions.${row.action}`, { defaultValue: row.action })}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-xs">{row.target ?? "—"}</td>
                    <td className="py-2 text-xs text-muted-foreground">
                      {row.organizationName ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Range navigation — the journal only grows; never list it whole. */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs tabular-nums text-muted-foreground">
              {t("auditAdmin.range", {
                from: data.page * pageSize + 1,
                to: data.page * pageSize + data.rows.length,
                total: data.total.toLocaleString(i18n.language),
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
                {t("auditAdmin.prev")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs"
                disabled={(data.page + 1) * pageSize >= data.total}
                onClick={() => setPage((p) => p + 1)}
              >
                {t("auditAdmin.next")}
              </Button>
            </span>
          </div>
        </>
      )}
    </section>
  );
}
