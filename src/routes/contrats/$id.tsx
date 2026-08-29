// The contract fiche (Phase P4, brief §3.2 + §3.3).
//
// Everything the brief asks a contract to show — number, subject, linked
// dossier, buyer, supplier, value, incoterm, terms, dates, status — and the
// parties table with per-party signature state and action.
//
// The signature ACTIONS themselves (sign in-platform, upload a countersigned
// PDF, send a reminder) are P6. This is the surface they land on.

import { useState } from "react";
import { createFileRoute, Link, notFound, useRouter } from "@tanstack/react-router";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { getContractsFn, regenerateContractContentFn, type ContractView } from "@/lib/contract-fns";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/contrats/$id")({
  loader: async ({ params }) => {
    // One query, filtered client-side: the list is small per workspace and
    // this keeps a single authorisation path rather than a second one that
    // could drift out of step with it.
    const result = await getContractsFn();
    const contract = result.contracts.find((c) => c.id === params.id);
    if (!contract) throw notFound();
    return { contract, canDraft: result.canDraft };
  },
  component: ContractDetail,
});

const PARTY_STYLE: Record<string, string> = {
  pending: "border-border text-muted-foreground",
  signed: "border-success/50 text-success",
  declined: "border-destructive/50 text-destructive",
};

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium" title={value}>
        {value}
      </dd>
    </div>
  );
}

function ContractDetail() {
  const { t, i18n } = useTranslation();
  const { contract, canDraft } = Route.useLoaderData() as {
    contract: ContractView;
    canDraft: boolean;
  };
  const router = useRouter();
  const [redrafting, setRedrafting] = useState(false);

  const money =
    contract.amountCents === null
      ? "—"
      : contract.currency
        ? new Intl.NumberFormat(i18n.language, {
            style: "currency",
            currency: contract.currency,
          }).format(contract.amountCents / 100)
        : (contract.amountCents / 100).toLocaleString(i18n.language);

  const date = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString(i18n.language, {
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : t("contrats.noDue");

  return (
    <div className="space-y-6 pt-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
        <div className="min-w-0">
          <Link
            to="/contrats"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-gold"
          >
            <ArrowLeft className="size-3.5" /> {t("contrats.title")}
          </Link>
          <h1 className="mt-2 truncate font-display text-2xl font-semibold">
            <span className="font-mono text-gold">{contract.number}</span>
          </h1>
          <p className="mt-1 truncate text-sm text-muted-foreground">{contract.title}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="tabular-nums text-sm font-semibold">
            {contract.signed} / {contract.requiredSignatures}
          </span>
          <span className="rounded-full border border-border px-3 py-1 text-[11px] font-semibold">
            {t(`contrats.status.${contract.status}`)}
          </span>
        </div>
      </header>

      <section className="card-surface p-6">
        <dl className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <Field label={t("contrats.type.label")} value={t(`contrats.type.${contract.type}`)} />
          <Field label={t("contrats.col.value")} value={money} />
          <Field label={t("contrats.incoterm")} value={contract.incoterm ?? "—"} />
          <Field label={t("contrats.dueAt")} value={date(contract.dueAt)} />
          <Field label={t("contrats.supplier")} value={contract.supplierName} />
          <Field label={t("contrats.paymentTerms")} value={contract.paymentTerms ?? "—"} />
          <Field label={t("contrats.col.date")} value={date(contract.createdAt)} />
          <div className="min-w-0">
            <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {t("contrats.deal")}
            </dt>
            <dd className="mt-0.5 truncate text-sm font-medium">{contract.dealTitle}</dd>
          </div>
        </dl>
      </section>

      <section className="card-surface p-6">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">
              {contract.content ? contract.content.title : t("contrats.document")}
            </h2>
            {contract.content && (
              /* The language the DOCUMENT is, not the one the reader picked:
                 what was signed is what was signed. */
              <p className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                {t("contrats.documentLocale", {
                  lang: t(`contrats.lang.${contract.content.locale}`),
                })}
              </p>
            )}
          </div>
          {/* Re-drafting is refused past `draft` on the server too — the
              button hiding is a courtesy, not the rule. */}
          {canDraft && contract.status === "draft" && (
            <Button
              variant="outline"
              size="sm"
              disabled={redrafting}
              onClick={() => {
                setRedrafting(true);
                void regenerateContractContentFn({ data: { contractId: contract.id } })
                  .then(() => router.invalidate())
                  .finally(() => setRedrafting(false));
              }}
            >
              <RefreshCw className={cn("size-3.5", redrafting && "animate-spin")} />
              {t("contrats.redraft")}
            </Button>
          )}
        </div>

        {contract.status === "draft" && (
          <p className="mt-4 rounded-lg border border-gold/40 bg-gold-soft px-4 py-2.5 text-xs text-muted-foreground">
            {t("contrats.draftNotice")}
          </p>
        )}

        {contract.content === null ? (
          <p className="mt-4 text-sm text-muted-foreground">{t("contrats.noContent")}</p>
        ) : (
          <div className="mt-5 space-y-5">
            {contract.content.sections.map((section) => (
              <article key={section.heading}>
                <h3 className="text-sm font-semibold">{section.heading}</h3>
                <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                  {section.body}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="card-surface p-6">
        <h2 className="text-base font-semibold">{t("contrats.parties")}</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-medium">{t("contrats.partyCol.party")}</th>
                <th className="px-3 py-2 font-medium">{t("contrats.partyCol.role")}</th>
                <th className="px-3 py-2 font-medium">{t("contrats.partyCol.status")}</th>
                <th className="px-3 py-2 font-medium">{t("contrats.partyCol.action")}</th>
              </tr>
            </thead>
            <tbody>
              {contract.parties.map((party) => (
                <tr key={party.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-3">
                    <span className="block font-medium">{party.name}</span>
                    {party.email && (
                      <span className="text-[11px] text-muted-foreground">{party.email}</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {t(`contrats.role.${party.role}`)}
                    {!party.required && (
                      <span className="ml-1.5 text-[11px]">({t("contrats.optional")})</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={cn(
                        "rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
                        PARTY_STYLE[party.signatureStatus],
                      )}
                    >
                      {t(`contrats.partyStatus.${party.signatureStatus}`)}
                    </span>
                    {party.signedByName && (
                      <span className="ml-2 text-[11px] text-muted-foreground">
                        {party.signedByName}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-[11px] text-muted-foreground">
                    {/* P6 lands the actions here: sign in-platform for a party
                        with an account, upload the countersigned PDF for one
                        without, and a reminder for anyone still pending. */}
                    {party.signatureStatus === "pending" ? t("contrats.actionSoon") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
