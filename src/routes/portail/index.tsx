import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

// The supplier portal's home (Phase V · V03 — the shell; V16 brings the RFQs).
//
// Reached only by an external account: the root guard sends every other
// session away (`authRedirect`), and an external session everywhere else is
// sent here. Until V16 there is nothing to list, and the page says so rather
// than pretending.
export const Route = createFileRoute("/portail/")({
  head: () => ({ meta: [{ title: "Portail fournisseur | OSI" }] }),
  component: PortalHome,
});

function PortalHome() {
  const { t } = useTranslation();
  return (
    <section className="card-surface p-6">
      <h1 className="font-display text-xl font-semibold">{t("portal.homeTitle")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t("portal.homeEmpty")}</p>
    </section>
  );
}
