// The contract list (Phase P4, brief §3.1) — the module the owner named as
// the development priority.
//
// The five filters and the N/M indicator are DERIVED on the server from the
// party rows (contractFilter / signatureProgress in src/lib/deal-status.ts).
// Nothing here recomputes a rule, and no column stores one.

import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { FileSignature, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { useRouter } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { draftContractsFn, getContractsFn, type ContractView } from "@/lib/contract-fns";
import type { ContractFilter } from "@/lib/deal-status";
import {
  AccountFilter,
  accountOptions,
  filterByAccount,
  ALL_ACCOUNTS,
} from "@/components/osi/AccountFilter";
import { formatDay } from "@/lib/instant";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/contrats/")({
  head: () => ({
    meta: [
      { title: "Contrats | OSI" },
      {
        name: "description",
        content: "Le centre contractuel : parties, signatures, échéances et historique.",
      },
    ],
  }),
  loader: async () => await getContractsFn(),
  component: Contrats,
});

const FILTERS: readonly (ContractFilter | "tous")[] = [
  "tous",
  "actifs",
  "a_signer",
  "en_attente",
  "completes",
  "expires",
];

const STATUS_STYLE: Record<string, string> = {
  draft: "border-border text-muted-foreground",
  sent: "border-border text-muted-foreground",
  partially_signed: "border-gold/50 bg-gold-soft text-gold",
  signed: "border-success/50 text-success",
  voided: "border-border text-muted-foreground line-through",
  expired: "border-destructive/50 text-destructive",
};

function money(cents: number | null, currency: string | null, lang: string): string {
  if (cents === null) return "—";
  return currency
    ? new Intl.NumberFormat(lang, { style: "currency", currency }).format(cents / 100)
    : (cents / 100).toLocaleString(lang);
}

/** "2 / 4" — mandatory signatures only, so an optional party signing never
 *  makes the indicator read complete. */
function SignatureCount({ contract }: { contract: ContractView }) {
  const complete =
    contract.requiredSignatures > 0 && contract.signed === contract.requiredSignatures;
  return (
    <span
      className={cn(
        "tabular-nums text-xs font-semibold",
        complete ? "text-success" : "text-muted-foreground",
      )}
    >
      {contract.signed} / {contract.requiredSignatures}
    </span>
  );
}

function Contrats() {
  const { t, i18n } = useTranslation();
  const { contracts, pendingDeals, canDraft } = Route.useLoaderData();
  const router = useRouter();
  const [drafting, setDrafting] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("tous");
  const [query, setQuery] = useState("");
  // Staff stand in the internal workspace and see every account's contracts;
  // a buyer sees one account and is never offered the control.
  const [account, setAccount] = useState<string>(ALL_ACCOUNTS);
  const accounts = canDraft ? accountOptions(contracts) : [];
  const inAccount = canDraft ? filterByAccount(contracts, account) : contracts;

  const term = query.trim().toLowerCase();
  const shown = inAccount.filter((contract) => {
    if (filter !== "tous" && contract.filter !== filter) return false;
    if (!term) return true;
    // Brief §3.1: search by number, company, supplier, type or project.
    return [contract.number, contract.title, contract.supplierName, contract.dealTitle]
      .join(" ")
      .toLowerCase()
      .includes(term);
  });

  // Counts follow the selected account — a tab promising "Actifs (7)" while
  // the list can only show that account's two would be a lie.
  const countFor = (key: (typeof FILTERS)[number]) =>
    key === "tous" ? inAccount.length : inAccount.filter((c) => c.filter === key).length;

  return (
    <div className="space-y-6 pt-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div className="min-w-0">
          <h1 className="truncate font-display text-2xl font-semibold">{t("contrats.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("contrats.subtitle", { count: contracts.length })}
          </p>
        </div>
      </header>

      {canDraft && filterByAccount(pendingDeals, account).length > 0 && (
        <section className="card-surface border-gold/40 p-4">
          <p className="text-xs text-muted-foreground">{t("contrats.pendingHint")}</p>
          <ul className="mt-3 space-y-2">
            {filterByAccount(pendingDeals, account).map((deal) => (
              <li
                key={deal.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-lg border border-border px-4 py-2.5"
              >
                <span className="min-w-0 truncate text-sm">
                  {deal.title}
                  <span className="ml-2 text-[11px] text-muted-foreground">
                    {deal.organizationName} · {deal.supplierName}
                  </span>
                </span>
                <Button
                  variant="gold"
                  size="sm"
                  disabled={drafting !== null}
                  onClick={() => {
                    setDrafting(deal.id);
                    void draftContractsFn({ data: { dealId: deal.id } })
                      .then(() => router.invalidate())
                      .finally(() => setDrafting(null));
                  }}
                >
                  {t("contrats.draft")} ({deal.missing})
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {canDraft && (
        <AccountFilter
          options={accounts}
          value={account}
          onChange={setAccount}
          total={contracts.length}
        />
      )}

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              filter === key
                ? "border-transparent bg-gold-gradient text-gold-foreground shadow-gold"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {t(`contrats.filter.${key}`)} ({countFor(key)})
          </button>
        ))}
        <div className="relative ml-auto min-w-[200px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("contrats.search")}
            className="h-9 pl-9"
          />
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="card-surface border-dashed px-6 py-12 text-center">
          <FileSignature className="mx-auto size-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm text-muted-foreground">{t("contrats.empty")}</p>
        </div>
      ) : (
        <div className="card-surface overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">{t("contrats.col.number")}</th>
                <th className="px-4 py-3 font-medium">{t("contrats.col.subject")}</th>
                {canDraft && <th className="px-4 py-3 font-medium">{t("contrats.col.account")}</th>}
                <th className="px-4 py-3 font-medium">{t("contrats.col.parties")}</th>
                <th className="px-4 py-3 font-medium">{t("contrats.col.value")}</th>
                <th className="px-4 py-3 font-medium">{t("contrats.col.status")}</th>
                <th className="px-4 py-3 font-medium">{t("contrats.col.signatures")}</th>
                <th className="px-4 py-3 font-medium">{t("contrats.col.date")}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((contract) => (
                <tr
                  key={contract.id}
                  className="border-b border-border last:border-0 transition-colors hover:bg-secondary/40"
                >
                  <td className="px-4 py-3">
                    <Link
                      to="/contrats/$id"
                      params={{ id: contract.id }}
                      className="font-mono text-xs font-semibold text-gold hover:underline"
                    >
                      {contract.number}
                    </Link>
                  </td>
                  <td className="max-w-[220px] px-4 py-3">
                    <span className="block truncate" title={contract.title}>
                      {contract.title}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {t(`contrats.type.${contract.type}`)}
                    </span>
                  </td>
                  {canDraft && (
                    <td className="max-w-[160px] px-4 py-3 text-muted-foreground">
                      <span className="block truncate" title={contract.organizationName}>
                        {contract.organizationName}
                      </span>
                    </td>
                  )}
                  <td className="px-4 py-3 tabular-nums text-muted-foreground">
                    {contract.parties.length}
                  </td>
                  <td className="px-4 py-3 tabular-nums">
                    {money(contract.amountCents, contract.currency, i18n.language)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
                        STATUS_STYLE[contract.status],
                      )}
                    >
                      {t(`contrats.status.${contract.status}`)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <SignatureCount contract={contract} />
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {formatDay(contract.createdAt, i18n.language)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
