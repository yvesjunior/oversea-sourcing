import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { formatDay } from "@/lib/instant";
import { getHubCasesFn, type HubCaseSummary } from "@/lib/partner-portal-fns";
import { cn } from "@/lib/utils";

// The Partner Hub's home (Phase V · V23): the cases addressed to the caller's
// partner(s), and nothing else.
//
// Reached only by a partner account — the root guard sends every other
// session away, a supplier's included. `getHubCasesFn` answers null for an
// account linked to no partner; the page says so rather than showing an empty
// list, because "nothing was asked of you" and "you answer for nobody" are
// different facts.
export const Route = createFileRoute("/partenaires/")({
  loader: async () => ({ cases: await getHubCasesFn() }),
  head: () => ({ meta: [{ title: "Partner Hub | OSI" }] }),
  component: HubHome,
});

const STATUS_STYLE: Record<HubCaseSummary["status"], string> = {
  open: "bg-gold-soft text-gold",
  answered: "bg-success/15 text-success",
  cancelled: "bg-secondary text-muted-foreground",
};

function HubHome() {
  const { t, i18n } = useTranslation();
  const { cases } = Route.useLoaderData();

  if (cases === null) {
    return (
      <section className="card-surface p-6">
        <h1 className="font-display text-xl font-semibold">{t("partnerHub.homeTitle")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("partnerHub.noPartner")}</p>
      </section>
    );
  }

  // More than one partner behind this account (a company that both ships and
  // clears is two partners): say which one each case went to.
  const several = new Set(cases.map((c) => c.partnerName)).size > 1;

  return (
    <section className="space-y-4">
      <h1 className="font-display text-xl font-semibold">{t("partnerHub.homeTitle")}</h1>
      {cases.length === 0 ? (
        <p className="card-surface p-6 text-sm text-muted-foreground">
          {t("partnerHub.homeEmpty")}
        </p>
      ) : (
        <ul className="space-y-3">
          {cases.map((item) => (
            <li key={item.id}>
              <Link
                to="/partenaires/dossier/$id"
                params={{ id: item.id }}
                className="card-surface grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 p-5 transition-colors hover:border-gold/50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{item.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t(`partnersAdmin.kind.${item.kind}`)} ·{" "}
                    {t("partnerHub.reference", { reference: item.reference })}
                    {several && <> · {item.partnerName}</>}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.current
                      ? t("partnerHub.yourFigure", {
                          amount: new Intl.NumberFormat(i18n.language, {
                            style: "currency",
                            currency: item.current.currency,
                          }).format(item.current.amountCents / 100),
                        })
                      : t("partnerHub.openedOn", {
                          when: formatDay(item.openedAt, i18n.language),
                        })}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold",
                    STATUS_STYLE[item.status],
                  )}
                >
                  {t(`partnerHub.status.${item.status}`)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
