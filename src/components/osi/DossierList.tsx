import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { formatDay } from "@/lib/instant";
import type { DossierSummary } from "@/lib/dossier-fns";

/**
 * The dossiers an EXTERNAL reader is on (Phase V · V25) — the supplier
 * portal's and the Partner Hub's list. Renders nothing when there is none:
 * most accounts have no dossier, and an empty heading would read as a gap.
 *
 * It names nobody: the summary an external reader is sent carries a title, a
 * status and a date (`listDossiers`).
 */
export function DossierList({
  dossiers,
  to,
}: {
  dossiers: DossierSummary[];
  to: "/portail/transaction/$id" | "/partenaires/transaction/$id";
}) {
  const { t, i18n } = useTranslation();
  if (dossiers.length === 0) return null;
  return (
    <div className="space-y-3">
      <h2 className="font-display text-xl font-semibold">{t("room.yourDossiers")}</h2>
      <ul className="space-y-3">
        {dossiers.map((dossier) => (
          <li key={dossier.id}>
            <Link
              to={to}
              params={{ id: dossier.id }}
              className="card-surface grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 p-5 transition-colors hover:border-gold/50"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{dossier.title}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t(`contrats.role.${dossier.role}`)} ·{" "}
                  {t("room.openedOn", { when: formatDay(dossier.openedAt, i18n.language) })}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-gold-soft px-2.5 py-1 text-[11px] font-semibold text-gold">
                {t(`dealBox.status.${dossier.status}`)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
