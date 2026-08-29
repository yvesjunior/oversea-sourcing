import { createFileRoute } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Timeline } from "@/components/osi/Timeline";
import { etapesTransaction } from "@/data/osi";
import { canSeeAllRequests } from "@/lib/roles";
import { Progress } from "@/components/ui/progress";

export const Route = createFileRoute("/transactions")({
  head: () => ({
    meta: [
      { title: "Transactions sécurisées | OSI" },
      {
        name: "description",
        content:
          "Suivez vos commandes, paiements sécurisés, fabrication, douanes et livraisons en un seul flux.",
      },
      { property: "og:title", content: "Transactions sécurisées | OSI" },
      {
        property: "og:description",
        content: "De la commande confirmée à la livraison, tout est traçable.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Transactions,
});

function Transactions() {
  const { t } = useTranslation();
  // Showcase content until E8 wires real transactions through the DB.
  const contenu = (
    <section className="card-surface max-w-2xl p-6">
      <h2 className="text-base font-semibold">{t("transactions.txTitle")}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{t("transactions.txSubtitle")}</p>

      {/* Timeline takes display strings since E3 — translate the keys here. */}
      <Timeline
        etapes={etapesTransaction.map((etape) => ({
          ...etape,
          titre: t(etape.titre),
          detail: t(etape.detail),
        }))}
        className="mt-6"
      />

      <div className="mt-6 rounded-xl border border-border bg-secondary/60 p-4">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <span className="truncate text-xs text-muted-foreground">
            {t("transactions.fabProgress")}
          </span>
          <span className="text-sm font-semibold">65%</span>
        </div>
        <Progress value={65} className="mt-2 h-1.5" />
      </div>

      <Button variant="outline" className="mt-6 w-full">
        <FileText className="size-4" /> {t("transactions.viewDocs")}
      </Button>
    </section>
  );

  return (
    <div className="space-y-6 pt-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <h1 className="truncate font-display text-2xl font-semibold">{t("transactions.title")}</h1>
        <span className="flex items-center gap-2 rounded-full bg-secondary px-3 py-1 text-xs">
          <span className="size-2 rounded-full bg-success" /> {t("transactions.inProgress")}
        </span>
      </header>

      {/* No "Mes données": OSI's own workspace holds no customer data
          (owner 2026-08-29), so that tab could only ever be empty. */}
      {contenu}
    </div>
  );
}
