import { Link } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { enUS, fr } from "date-fns/locale";
import { FileBox } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { RequestSummary } from "@/lib/requests-fns";
import { ScoreRing } from "./ScoreRing";
import { StatusPill } from "./StatusPill";

export function DossierCard({ demande }: { demande: RequestSummary }) {
  const { t, i18n } = useTranslation();
  // A relative timestamp is computed from the CURRENT time, so the server and
  // the browser format it at two different instants — cross a minute boundary
  // and the strings differ, which is a hydration mismatch by construction.
  // Cheap to prevent, and the standard React answer for timestamps: allow the
  // text to differ on this one element. A label a few seconds stale is
  // invisible; React discarding the server HTML is not. (Prophylactic — this
  // has not been observed in the wild, see doc/BACKLOG.md 2026-08-29.)
  const maj = formatDistanceToNow(new Date(demande.updatedAt), {
    addSuffix: true,
    locale: i18n.language === "fr" ? fr : enUS,
  });

  return (
    <Link
      to="/demandes/$id"
      params={{ id: demande.id }}
      className="card-surface group block p-5 transition-all hover:-translate-y-0.5 hover:border-gold/50 hover:shadow-gold"
    >
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <FileBox className="size-4 shrink-0" />
        <span>#{demande.id}</span>
        {demande.workspaceName && (
          <span className="ml-auto max-w-[55%] truncate rounded-full bg-gold-soft px-2 py-0.5 text-[10px] font-semibold text-gold">
            {demande.workspaceName}
          </span>
        )}
      </div>

      <h3 className="mt-3 truncate text-base font-semibold">{demande.title}</h3>

      <div className="mt-5 space-y-3 text-sm">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <span className="text-xs text-muted-foreground">{t("dossier.status")}</span>
          <StatusPill statut={demande.status} />
        </div>
        {demande.compatibilityScore !== null && (
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
            <span className="text-xs text-muted-foreground">{t("dossier.compatibility")}</span>
            <span className="flex items-center gap-2">
              <span className="font-semibold">{demande.compatibilityScore}%</span>
              <ScoreRing valeur={demande.compatibilityScore} taille={26} />
            </span>
          </div>
        )}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-border pt-3">
          <span className="text-xs text-muted-foreground">{t("dossier.updated")}</span>
          <span className="text-xs text-muted-foreground" suppressHydrationWarning>
            {maj}
          </span>
        </div>
        {/* Attribution inside a shared workspace — the snapshot survives the
            creator's account deletion (UC-6 re-interpretation). */}
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <span className="text-xs text-muted-foreground">{t("dossier.createdBy")}</span>
          <span className="max-w-[60%] truncate text-xs font-medium">
            {demande.createdByName ?? t("common.deletedUser")}
          </span>
        </div>
      </div>
    </Link>
  );
}
