import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { DossierList } from "@/components/osi/DossierList";
import { getMyDossiersFn, getMyRfqsFn, type PortalRfqSummary } from "@/lib/portal-fns";
import { formatDeadline } from "@/lib/rfq-mail";
import { cn } from "@/lib/utils";

// The supplier portal's home (Phase V · V16): the RFQs addressed to the
// caller's supplier(s), and nothing else.
//
// Reached only by an external account — the root guard sends every other
// session away. `getMyRfqsFn` answers null for an account that is not linked
// to a supplier; the page says so rather than showing an empty list, because
// "nothing was sent to you" and "you answer for nobody" are different facts.
export const Route = createFileRoute("/portail/")({
  loader: async () => {
    const [rfqs, dossiers] = await Promise.all([getMyRfqsFn(), getMyDossiersFn()]);
    return { rfqs, dossiers: dossiers ?? [] };
  },
  head: () => ({ meta: [{ title: "Portail fournisseur | OSI" }] }),
  component: PortalHome,
});

const STATE_STYLE: Record<PortalRfqSummary["state"], string> = {
  to_answer: "bg-gold-soft text-gold",
  answered: "bg-success/15 text-success",
  declined: "bg-secondary text-muted-foreground",
  closed: "bg-secondary text-muted-foreground",
};

function PortalHome() {
  const { t, i18n } = useTranslation();
  const { rfqs, dossiers } = Route.useLoaderData();
  const locale = i18n.language === "en" ? "en" : "fr";

  if (rfqs === null) {
    return (
      <section className="card-surface p-6">
        <h1 className="font-display text-xl font-semibold">{t("portal.homeTitle")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("portal.noSupplier")}</p>
      </section>
    );
  }

  // More than one supplier behind this account: say which one each RFQ went to.
  const several = new Set(rfqs.map((rfq) => rfq.supplierName)).size > 1;

  return (
    <section className="space-y-4">
      {/* The dossiers an accepted offer opened (V25) — above the RFQs: they
          are what is in motion. */}
      <DossierList dossiers={dossiers} to="/portail/transaction/$id" />
      <h1 className="font-display text-xl font-semibold">{t("portal.homeTitle")}</h1>
      {rfqs.length === 0 ? (
        <p className="card-surface p-6 text-sm text-muted-foreground">{t("portal.homeEmpty")}</p>
      ) : (
        <ul className="space-y-3">
          {rfqs.map((rfq) => (
            <li key={rfq.id}>
              <Link
                to="/portail/rfq/$id"
                params={{ id: rfq.id }}
                className="card-surface grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 p-5 transition-colors hover:border-gold/50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{rfq.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("portal.reference", { id: rfq.reference })}
                    {several && <> · {rfq.supplierName}</>}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {rfq.state === "to_answer"
                      ? t("portal.deadline", {
                          when: formatDeadline(new Date(rfq.closesAt), locale),
                        })
                      : rfq.answeredAt
                        ? t("portal.answeredOn", {
                            when: formatDeadline(new Date(rfq.answeredAt), locale),
                          })
                        : null}
                  </p>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold",
                    STATE_STYLE[rfq.state],
                  )}
                >
                  {t(`portal.state.${rfq.state}`)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
