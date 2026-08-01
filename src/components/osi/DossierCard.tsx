import { Link } from "@tanstack/react-router";
import { FileBox } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Dossier } from "@/data/osi";
import { ScoreRing } from "./ScoreRing";
import { StatusPill } from "./StatusPill";

export function DossierCard({ dossier }: { dossier: Dossier }) {
  const { t } = useTranslation();
  return (
    <Link
      to="/demandes/$id"
      params={{ id: dossier.id }}
      className="card-surface group block p-5 transition-all hover:-translate-y-0.5 hover:border-gold/50 hover:shadow-gold"
    >
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <FileBox className="size-4 shrink-0" />
        <span>#{dossier.id}</span>
      </div>

      <h3 className="mt-3 truncate text-base font-semibold">{t(`dossiers.${dossier.id}`)}</h3>

      <div className="mt-5 space-y-3 text-sm">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <span className="text-xs text-muted-foreground">{t("dossier.status")}</span>
          <StatusPill statut={dossier.statut} />
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <span className="text-xs text-muted-foreground">{t("dossier.compatibility")}</span>
          <span className="flex items-center gap-2">
            <span className="font-semibold">{dossier.compatibilite}%</span>
            <ScoreRing valeur={dossier.compatibilite} taille={26} />
          </span>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-border pt-3">
          <span className="text-xs text-muted-foreground">{t("dossier.updated")}</span>
          <span className="text-xs text-muted-foreground">{t(dossier.maj)}</span>
        </div>
      </div>
    </Link>
  );
}
