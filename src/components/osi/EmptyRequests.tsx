import { Link } from "@tanstack/react-router";
import { FileBox, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";

/** Shown when the user has no sourcing requests yet — sends them to the intake
 *  form. That form moved from `/` to `/demandes` on 2026-08-29 (ADR §11) and
 *  this link did not follow, so on the dashboard the button reloaded the page
 *  the buyer was already on: a dead end exactly where they have nothing yet.
 *  `/demandes` opens its form by default when the list is empty, so arriving
 *  there with no requests lands on an open form. */
export function EmptyRequests() {
  const { t } = useTranslation();
  return (
    // Compact: no taller than a row of dossier cards, so dashboards with an
    // empty state (e.g. accountant) match the buyer page height (footer stays
    // fully visible in every mode).
    <div className="card-surface flex flex-col items-center gap-2 border-dashed px-6 py-7 text-center">
      <span className="grid size-10 place-items-center rounded-xl bg-gold-soft text-gold">
        <FileBox className="size-4" />
      </span>
      <p className="text-sm font-semibold">{t("demandes.emptyTitle")}</p>
      <Link
        to="/demandes"
        className="mt-1 inline-flex items-center gap-2 rounded-lg bg-gold-gradient px-4 py-1.5 text-sm font-medium text-gold-foreground shadow-gold transition-opacity hover:opacity-90"
      >
        <Sparkles className="size-4" /> {t("demandes.emptyCta")}
      </Link>
    </div>
  );
}
