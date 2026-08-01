import { useTranslation } from "react-i18next";
import type { Risque } from "@/data/osi";
import { cn } from "@/lib/utils";

const puces: Record<Risque, string> = {
  Faible: "bg-success",
  Moyen: "bg-warning",
  Élevé: "bg-destructive",
};

export function RiskBadge({ risque, className }: { risque: Risque; className?: string }) {
  const { t } = useTranslation();
  return (
    <span className={cn("flex items-center gap-2 text-xs font-medium", className)}>
      <span className={cn("size-2 shrink-0 rounded-full", puces[risque])} />
      {t(`risk.${risque}`)}
    </span>
  );
}
