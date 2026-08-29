// Narrow a staff list to ONE customer account (owner, 2026-08-29).
//
// Staff stand in the internal workspace and their "Vue globale" lists carry
// every customer's rows at once — which is right for an ops queue and useless
// when someone asks "where are we with account X". Both halves of the answer
// matter: the row has to SAY whose it is, and the list has to be narrowable
// to that account.
//
// Client-side on purpose. The staff lists are already loaded whole (they are
// ops queues, not archives), so filtering here keeps one authorisation path
// and one query instead of a second, subtly different, server filter. If a
// list ever outgrows that, the fix is pagination on the server — and this
// control moves with it rather than being duplicated.

import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** The accounts present IN THE DATA, with how many rows each holds — never a
 *  full account list, so the control cannot offer a choice that yields an
 *  empty screen. */
export type AccountOption = { id: string; name: string; count: number };

export const ALL_ACCOUNTS = "__all__";

/** Build the options from rows that each name their owning account. */
export function accountOptions(
  rows: readonly { organizationId: string; organizationName: string }[],
): AccountOption[] {
  const byId = new Map<string, AccountOption>();
  for (const row of rows) {
    const found = byId.get(row.organizationId);
    if (found) found.count += 1;
    else
      byId.set(row.organizationId, {
        id: row.organizationId,
        name: row.organizationName,
        count: 1,
      });
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function filterByAccount<T extends { organizationId: string }>(
  rows: readonly T[],
  accountId: string,
): T[] {
  return accountId === ALL_ACCOUNTS
    ? [...rows]
    : rows.filter((r) => r.organizationId === accountId);
}

export function AccountFilter({
  options,
  value,
  onChange,
  total,
}: {
  options: AccountOption[];
  value: string;
  onChange: (value: string) => void;
  /** Rows across every account — what "Tous les comptes" would show. */
  total: number;
}) {
  const { t } = useTranslation();
  // One account in the data means nothing to choose between; the label on the
  // rows already answers "whose is this".
  if (options.length < 2) return null;

  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {t("accountFilter.label")}
      </span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-9 min-w-[200px] text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_ACCOUNTS} className="text-xs">
            {t("accountFilter.all", { count: total })}
          </SelectItem>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id} className="text-xs">
              {option.name} ({option.count})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
