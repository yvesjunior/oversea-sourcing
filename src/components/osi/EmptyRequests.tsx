import { Link } from "@tanstack/react-router";
import { FileBox, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

/** Shown when the user has no sourcing requests yet — points back to the hero prompt. */
export function EmptyRequests() {
  const { t } = useTranslation();
  return (
    <div className="card-surface flex flex-col items-center gap-3 border-dashed px-6 py-12 text-center">
      <span className="grid size-12 place-items-center rounded-2xl bg-gold-soft text-gold">
        <FileBox className="size-5" />
      </span>
      <p className="text-sm font-semibold">{t("demandes.emptyTitle")}</p>
      <p className="max-w-sm text-xs text-muted-foreground">{t("demandes.emptyText")}</p>
      <Link
        to="/"
        className="mt-2 inline-flex items-center gap-2 rounded-lg bg-gold-gradient px-4 py-2 text-sm font-medium text-gold-foreground shadow-gold transition-opacity hover:opacity-90"
      >
        <Sparkles className="size-4" /> {t("demandes.emptyCta")}
      </Link>
    </div>
  );
}
