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
          <span className="text-xs text-muted-foreground">{maj}</span>
        </div>
      </div>
    </Link>
  );
}
