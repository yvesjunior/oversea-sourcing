import { useTranslation } from "react-i18next";
import type { RequestStatus } from "@/database/schema";
import type { RequestFlow } from "@/lib/request-status";
import { cn } from "@/lib/utils";

const couleurs: Record<RequestStatus, string> = {
  draft: "bg-muted-foreground",
  // Waiting on the buyer, and nothing runs until they act: gold, the colour
  // of "your move" on the dossier, not the amber of work in progress.
  spec_review: "bg-gold",
  received: "bg-muted-foreground",
  analyzing: "bg-success",
  searching: "bg-warning",
  validating: "bg-warning",
  // Pack flow: work in hand on OSI's side or the suppliers' — same amber as
  // the other "not done yet" states.
  shortlisted: "bg-warning",
  soliciting: "bg-warning",
  pack_review: "bg-warning",
  report_ready: "bg-success",
  unfulfilled: "bg-destructive",
  closed: "bg-muted-foreground",
  cancelled: "bg-destructive",
};

export function StatusPill({
  statut,
  flow = "report",
  className,
}: {
  statut: RequestStatus;
  /** `report_ready` is shared by both flows and means different things: the
   *  report on one, a released Decision Pack on the other. Everything else
   *  reads the same on either. */
  flow?: RequestFlow;
  className?: string;
}) {
  const { t } = useTranslation();
  const label =
    flow === "pack" && statut === "report_ready" ? "statuses.pack_ready" : `statuses.${statut}`;
  return (
    <span className={cn("flex min-w-0 items-center gap-2 text-sm font-medium", className)}>
      <span className={cn("size-2.5 shrink-0 rounded-full", couleurs[statut])} />
      <span className="truncate">{t(label)}</span>
    </span>
  );
}
