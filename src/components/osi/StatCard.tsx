import { BarChart3, FileBox, PiggyBank, Repeat, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { StatCardData } from "@/data/osi";
import { cn } from "@/lib/utils";

const icones = {
  demandes: FileBox,
  fournisseurs: Users,
  transactions: Repeat,
  economies: PiggyBank,
  analyses: BarChart3,
} as const;

export function StatCard({ data, className }: { data: StatCardData; className?: string }) {
  const { t } = useTranslation();
  const Icone = icones[data.icone];

  return (
    <div className={cn("card-surface p-5", className)}>
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-foreground">
          <Icone className="size-[18px]" />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-xs text-muted-foreground">
            {t(`stats.${data.key}`)}
          </span>
          <span className="mt-1 block truncate font-display text-2xl font-semibold">
            {data.valeur}
          </span>
        </span>
      </div>
      <p className="mt-4 text-xs">
        <span className="font-semibold text-success">{data.delta}</span>{" "}
        <span className="text-muted-foreground">{t(`stats.${data.note}`)}</span>
      </p>
    </div>
  );
}
