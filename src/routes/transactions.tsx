import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { getDossiersFn } from "@/lib/dossier-fns";
import { formatDay } from "@/lib/instant";
import { cn } from "@/lib/utils";

// The dossiers (Phase V · V25). Until V25 this page was a showcase: one
// invented transaction, drawn from a constant. It is now the list of the
// dossiers the caller is on — a buyer's own, every one for staff standing in
// the internal workspace — each leading to its Transaction Room.
export const Route = createFileRoute("/transactions")({
  loader: async () => ({ dossiers: await getDossiersFn() }),
  head: () => ({ meta: [{ title: "Dossiers | OSI" }, { name: "robots", content: "noindex" }] }),
  component: Transactions,
});

const STATUS_STYLE: Record<string, string> = {
  open: "bg-gold-soft text-gold",
  contracting: "bg-gold-soft text-gold",
  in_production: "bg-gold-soft text-gold",
  shipping: "bg-gold-soft text-gold",
  delivered: "bg-success/15 text-success",
  reviewed: "bg-success/15 text-success",
  closed: "bg-secondary text-muted-foreground",
  cancelled: "bg-secondary text-muted-foreground",
};

function Transactions() {
  const { t, i18n } = useTranslation();
  const { dossiers } = Route.useLoaderData();
  const items = dossiers?.items ?? [];

  return (
    <div className="space-y-6 pt-6">
      <header>
        <h1 className="font-display text-2xl font-semibold">{t("room.listTitle")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          {t(dossiers?.staff ? "room.listSubtitleStaff" : "room.listSubtitle")}
        </p>
      </header>

      {items.length === 0 ? (
        <p className="card-surface p-6 text-sm text-muted-foreground">{t("room.listEmpty")}</p>
      ) : (
        <ul className="space-y-3">
          {items.map((dossier) => (
            <li key={dossier.id}>
              <Link
                to="/dossiers/$id"
                params={{ id: dossier.id }}
                className="card-surface grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 p-5 transition-colors hover:border-gold/50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{dossier.title}</p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {[
                      dossier.buyerName,
                      dossier.supplierName,
                      t("room.openedOn", { when: formatDay(dossier.openedAt, i18n.language) }),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold",
                    STATUS_STYLE[dossier.status],
                  )}
                >
                  {t(`dealBox.status.${dossier.status}`)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
