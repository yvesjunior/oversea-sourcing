import { BarChart3, FileBox, PiggyBank, Repeat, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { StatCardConfig } from "@/data/osi";
import { cn } from "@/lib/utils";

const icones = {
  demandes: FileBox,
  fournisseurs: Users,
  transactions: Repeat,
  economies: PiggyBank,
  analyses: BarChart3,
} as const;

export function StatCard({
  config,
  value,
  delta,
  className,
}: {
  config: StatCardConfig;
  value: number;
  /** null → no history yet, the delta line is hidden */
  delta: number | null;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const Icone = icones[config.icone];
  const formatted = config.money
    ? `${value.toLocaleString(i18n.language === "fr" ? "fr-FR" : "en-US")} $`
    : value.toLocaleString(i18n.language === "fr" ? "fr-FR" : "en-US");

  return (
    <div className={cn("card-surface p-5", className)}>
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-foreground">
          <Icone className="size-[18px]" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-xs text-muted-foreground">
            {t(`stats.${config.labelKey}`)}
          </span>
          <span className="mt-1 block truncate font-display text-2xl font-semibold">
            {formatted}
          </span>
        </span>
      </div>
      {delta !== null && (
        <p className="mt-4 text-xs">
          <span className="font-semibold text-success">{delta >= 0 ? `+${delta}` : delta}</span>{" "}
          <span className="text-muted-foreground">{t(`stats.${config.note}`)}</span>
        </p>
      )}
    </div>
  );
}
