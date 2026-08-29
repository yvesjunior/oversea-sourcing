// E10 — the staff review surface (ADR-001 §4, tier ladder's human step).
// The queue lists every supplier that has been through the verification
// battery (= presented on a Top-N), sanctions alerts first, with the
// per-check evidence rows. "Vérifier" writes the human_review evidence row
// (→ Tier 3, Vérifié OSI, +12 in matching); "Retirer" deletes it and the
// tier falls back to the automated evidence. Status writes stay inside
// src/server/verification.ts (single-writer rule).

import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { CountryTag } from "@/components/osi/CountryTag";
import { EmptySection } from "@/components/osi/EmptySection";
import { requirePlatformFeature } from "@/lib/auth-guard";
import {
  getVerificationQueueFn,
  reviewSupplierFn,
  type EvidenceView,
  type VerificationQueueRow,
} from "@/lib/verification-fns";
import { cn } from "@/lib/utils";
import { formatDay } from "@/lib/instant";

export const Route = createFileRoute("/interne/verification")({
  head: () => ({
    meta: [{ title: "Vérification fournisseurs | OSI" }, { name: "robots", content: "noindex" }],
  }),
  beforeLoad: ({ context }) => {
    requirePlatformFeature(context.session, "verification");
  },
  loader: async () => await getVerificationQueueFn(),
  component: VerificationScreen,
});

const OUTCOME_STYLES: Record<EvidenceView["status"], string> = {
  passed: "bg-emerald-500/15 text-emerald-600",
  failed: "bg-destructive/15 text-destructive",
  inconclusive: "bg-secondary text-muted-foreground",
};

/** One evidence chip per check — the detail lives in the title tooltip so the
 *  row stays scannable. */
function EvidenceChip({ row }: { row: EvidenceView }) {
  const { t, i18n } = useTranslation();
  const d = row.detail;
  const details = [
    row.source ? `${t("verificationAdmin.source")}: ${row.source}` : null,
    d.registryName ?? null,
    d.snapshotAt
      ? `${t("verificationAdmin.snapshot")}: ${formatDay(d.snapshotAt, i18n.language)}`
      : null,
    d.reason ? t(`verificationAdmin.reasons.${d.reason}`) : null,
    d.siteStatus !== undefined ? `HTTP ${d.siteStatus}` : null,
    d.mx === true ? "MX ✓" : d.mx === false ? "MX —" : null,
    d.youngDomain ? t("verificationAdmin.youngDomain") : null,
    d.reviewedBy ? `${t("verificationAdmin.reviewedBy")}: ${d.reviewedBy}` : null,
    d.matches ? d.matches.map((m) => `${m.name} (${m.program ?? "?"})`).join(" · ") : null,
    formatDay(row.checkedAt, i18n.language),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <span
      title={details}
      className={cn(
        "cursor-help rounded-full px-2 py-0.5 text-[10px] font-semibold",
        OUTCOME_STYLES[row.status],
      )}
    >
      {t(`verificationAdmin.checks.${row.check}`)}{" "}
      {row.status === "passed" ? "✓" : row.status === "failed" ? "✗" : "?"}
    </span>
  );
}

function TierChip({ row }: { row: VerificationQueueRow }) {
  const { t } = useTranslation();
  if (row.sanctionsHit) {
    return (
      <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-semibold text-destructive">
        {t("verificationAdmin.sanctionsAlert")}
      </span>
    );
  }
  const styles =
    row.tier === 3
      ? "bg-gold-gradient text-gold-foreground"
      : row.tier >= 1
        ? "bg-emerald-500/15 text-emerald-600"
        : "bg-secondary text-muted-foreground";
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", styles)}>
      {t(`verificationAdmin.tiers.${row.tier}`)}
    </span>
  );
}

function VerificationScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const rows = Route.useLoaderData();
  const [busyId, setBusyId] = useState<string | null>(null);

  const review = async (supplierId: string, action: "approve" | "revoke") => {
    setBusyId(supplierId);
    try {
      await reviewSupplierFn({ data: { supplierId, action } });
      await router.invalidate();
    } finally {
      setBusyId(null);
    }
  };

  if (rows.length === 0) {
    return (
      <EmptySection
        icone={ShieldCheck}
        titleKey="empty.verificationTitle"
        textKey="empty.verificationText"
      />
    );
  }

  return (
    <div className="space-y-6 pt-6">
      <header>
        <h1 className="font-display text-2xl font-semibold">{t("verificationAdmin.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("verificationAdmin.subtitle")}</p>
      </header>

      <section className="card-surface p-6">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="pb-2 pr-4 font-medium">{t("verificationAdmin.supplier")}</th>
                <th className="pb-2 pr-4 font-medium">{t("verificationAdmin.evidence")}</th>
                <th className="pb-2 pr-4 font-medium">{t("verificationAdmin.tier")}</th>
                <th className="pb-2 font-medium">{t("verificationAdmin.action")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.supplierId}
                  className={cn(
                    "border-b border-border/60",
                    row.sanctionsHit && "bg-destructive/5",
                  )}
                >
                  <td className="py-3 pr-4">
                    <p className="flex items-center gap-2 font-medium">
                      {row.name} <CountryTag code={row.countryCode} />
                    </p>
                    {row.website && (
                      <a
                        href={row.website}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                      >
                        {row.website}
                      </a>
                    )}
                  </td>
                  <td className="py-3 pr-4">
                    <span className="flex flex-wrap gap-1.5">
                      {row.evidence.map((evidence) => (
                        <EvidenceChip key={evidence.check} row={evidence} />
                      ))}
                    </span>
                  </td>
                  <td className="py-3 pr-4">
                    <TierChip row={row} />
                  </td>
                  <td className="py-3">
                    {row.tier === 3 ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-xs"
                        disabled={busyId === row.supplierId}
                        onClick={() => void review(row.supplierId, "revoke")}
                      >
                        {t("verificationAdmin.revoke")}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="gold"
                        className="h-7 px-2 text-xs"
                        disabled={busyId === row.supplierId}
                        onClick={() => void review(row.supplierId, "approve")}
                      >
                        {t("verificationAdmin.approve")}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
