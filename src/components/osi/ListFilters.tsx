// The staff-list toolbar: which customer accounts, and which period.
//
// One component for the four ops lists — demandes, fournisseurs, soumissions,
// contrats (owner, 2026-08-29). Four copies of this logic would drift, and
// the drift would be silent: a list that filters "this week" one day earlier
// than its neighbour is not something anyone notices until they are chasing a
// dossier that seems to have vanished.
//
// The account filter is OMITTED where the dimension does not exist. Suppliers
// are platform-global by design (ADR-001: the pool is OSI's shared asset,
// enriched by every request), so "whose supplier is this" has no answer — and
// inventing one from the discovering request would leak, across tenants,
// which customer searched for a given part. `supplier-fns.ts` withholds that
// id deliberately; this control must not put it back.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AccountFilter, type AccountOption } from "@/components/osi/AccountFilter";
import { PeriodFilter, resolvePeriod } from "@/components/osi/PeriodFilter";
import { inRange, UNBOUNDED, type DateRange, type PeriodKey } from "@/lib/period";

export type ListFilters = {
  accounts: string[];
  setAccounts: (value: string[]) => void;
  period: PeriodKey;
  setPeriod: (value: PeriodKey) => void;
  custom: DateRange;
  setCustom: (value: DateRange) => void;
  /** The resolved bounds the list should filter by. */
  range: DateRange;
};

export function useListFilters(): ListFilters {
  const [accounts, setAccounts] = useState<string[]>([]);
  const [period, setPeriod] = useState<PeriodKey>("all");
  const [custom, setCustom] = useState<DateRange>(UNBOUNDED);
  return {
    accounts,
    setAccounts,
    period,
    setPeriod,
    custom,
    setCustom,
    range: resolvePeriod(period, custom),
  };
}

/**
 * Apply both filters to a list.
 *
 * `dateOf` is passed per list rather than assumed, because the honest date
 * differs: a soumission is filtered on when OSI ASKED, a request on when it
 * was created, a supplier on when it entered the pool. Using whatever
 * timestamp happens to be handy would move rows between periods for reasons
 * the person filtering never sees.
 */
export function applyListFilters<T>(
  rows: readonly T[],
  filters: ListFilters,
  accessors: { accountOf?: (row: T) => string; dateOf: (row: T) => string | null },
): T[] {
  return rows.filter((row) => {
    if (filters.accounts.length > 0 && accessors.accountOf) {
      if (!filters.accounts.includes(accessors.accountOf(row))) return false;
    }
    const date = accessors.dateOf(row);
    // A row with no date cannot be placed in a period. It stays visible while
    // no period is chosen and drops out once one is — never silently counted
    // into a window it may not belong to.
    if (filters.range.from === null && filters.range.to === null) return true;
    return date !== null && inRange(date, filters.range);
  });
}

export function ListFiltersBar({
  filters,
  accounts,
  total,
  shown,
}: {
  filters: ListFilters;
  /** Omit entirely on a list with no account dimension (suppliers). */
  accounts?: AccountOption[];
  total: number;
  shown: number;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        {accounts && (
          <AccountFilter
            options={accounts}
            value={filters.accounts}
            onChange={filters.setAccounts}
            total={total}
          />
        )}
        <PeriodFilter
          value={filters.period}
          onChange={filters.setPeriod}
          custom={filters.custom}
          onCustomChange={filters.setCustom}
        />
      </div>
      {/* Say what is being shown when it is not everything — a filtered list
          that looks like the whole queue is how work goes missing. */}
      {shown !== total && (
        <p className="text-xs text-muted-foreground">
          {t("listFilters.showing", { shown, total })}
        </p>
      )}
    </div>
  );
}
