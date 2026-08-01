import { useTranslation } from "react-i18next";
import type { Statut } from "@/data/osi";
import { cn } from "@/lib/utils";

const couleurs: Record<Statut, string> = {
  "En analyse": "bg-success",
  "Validation fournisseur": "bg-warning",
  "Rapport prêt": "bg-success",
  "Recherche terminée": "bg-warning",
};

export function StatusPill({ statut, className }: { statut: Statut; className?: string }) {
  const { t } = useTranslation();
  return (
    <span className={cn("flex min-w-0 items-center gap-2 text-sm font-medium", className)}>
      <span className={cn("size-2.5 shrink-0 rounded-full", couleurs[statut])} />
      <span className="truncate">{t(`statuses.${statut}`)}</span>
    </span>
  );
}
