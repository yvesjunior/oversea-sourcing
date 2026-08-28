// The staff logging surface (owner request 2026-08-27) — every
// lifecycle/admin action across ALL workspaces (org owners get the same
// journal scoped to their org in Paramètres → Journal). The purge control
// (entries older than AUDIT_RETENTION_MONTHS) is platform-owner-only.
// Writes: src/server/audit.ts; table: src/components/osi/AuditJournal.tsx.

import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AuditJournal } from "@/components/osi/AuditJournal";
import { Button } from "@/components/ui/button";
import { AUDIT_RETENTION_MONTHS, purgeAuditLogFn } from "@/lib/audit-fns";
import { hasSessionFeature, requirePlatformFeature } from "@/lib/auth-guard";

export const Route = createFileRoute("/interne/logging")({
  beforeLoad: ({ context }) => requirePlatformFeature(context.session, "logging"),
  head: () => ({ meta: [{ title: "Logging | OSI" }] }),
  // The journal loads client-side (filters + range pagination).
  component: Logging,
});

function Logging() {
  const { t } = useTranslation();
  const { session } = Route.useRouteContext();
  const canPurge = hasSessionFeature(session, "logging.purge");
  const [refreshTick, setRefreshTick] = useState(0);
  const [purging, setPurging] = useState(false);
  const [purged, setPurged] = useState<number | null>(null);

  const purge = async () => {
    if (!window.confirm(t("auditAdmin.purgeConfirm", { months: AUDIT_RETENTION_MONTHS }))) return;
    setPurging(true);
    try {
      const result = await purgeAuditLogFn();
      if (result.ok) {
        setPurged(result.deleted);
        setRefreshTick((n) => n + 1);
      }
    } finally {
      setPurging(false);
    }
  };

  return (
    <div className="space-y-6 pt-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-semibold">{t("auditAdmin.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("auditAdmin.subtitle")}</p>
        </div>
        {canPurge && (
          <span className="flex items-center gap-2">
            {purged !== null && (
              <span className="text-xs text-muted-foreground">
                {t("auditAdmin.purgeDone", { count: purged })}
              </span>
            )}
            <Button size="sm" variant="outline" disabled={purging} onClick={() => void purge()}>
              {t("auditAdmin.purgeButton", { months: AUDIT_RETENTION_MONTHS })}
            </Button>
          </span>
        )}
      </header>

      <AuditJournal showOrgFilter refreshTick={refreshTick} />
    </div>
  );
}
