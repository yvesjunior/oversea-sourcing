import { useTranslation } from "react-i18next";
import type { RequestStatus } from "@/database/schema";
import { cn } from "@/lib/utils";

const couleurs: Record<RequestStatus, string> = {
  draft: "bg-muted-foreground",
  received: "bg-muted-foreground",
  analyzing: "bg-success",
  searching: "bg-warning",
  validating: "bg-warning",
  report_ready: "bg-success",
  closed: "bg-muted-foreground",
  cancelled: "bg-destructive",
};

export function StatusPill({ statut, className }: { statut: RequestStatus; className?: string }) {
  const { t } = useTranslation();
  return (
    <span className={cn("flex min-w-0 items-center gap-2 text-sm font-medium", className)}>
      <span className={cn("size-2.5 shrink-0 rounded-full", couleurs[statut])} />
      <span className="truncate">{t(`statuses.${statut}`)}</span>
    </span>
  );
}
