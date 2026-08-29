// Narrow a staff list to one or more customer accounts (owner, 2026-08-29).
//
// Staff stand in the internal workspace and their "Vue globale" lists carry
// every customer's rows at once — which is right for an ops queue and useless
// when someone asks "where are we with account X". Both halves of the answer
// matter: the row has to SAY whose it is, and the list has to be narrowable
// to the accounts in question.
//
// MULTI-select rather than one-at-a-time (owner, 2026-08-29): comparing two
// accounts side by side is a real question, and a single-choice control makes
// it two page-loads and a memory test. An EMPTY selection means "all" — the
// filter is off, not a promise of an empty screen.
//
// Client-side on purpose. The staff lists are already loaded whole (they are
// ops queues, not archives), so filtering here keeps one authorisation path
// and one query instead of a second, subtly different, server filter. If a
// list ever outgrows that, the fix is pagination on the server — and this
// control moves with it rather than being duplicated.

import { useTranslation } from "react-i18next";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** The accounts present IN THE DATA, with how many rows each holds — never a
 *  full account list, so the control cannot offer a choice that yields an
 *  empty screen. */
export type AccountOption = { id: string; name: string; count: number };

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

/** No selection = no filter. Keeps "show me everything" and "show me nothing"
 *  from sharing a representation, which is how empty-screen bugs start. */
export function filterByAccounts<T extends { organizationId: string }>(
  rows: readonly T[],
  accountIds: readonly string[],
): T[] {
  if (accountIds.length === 0) return [...rows];
  return rows.filter((row) => accountIds.includes(row.organizationId));
}

export function AccountFilter({
  options,
  value,
  onChange,
  total,
}: {
  options: AccountOption[];
  /** Selected account ids; empty means every account. */
  value: string[];
  onChange: (value: string[]) => void;
  /** Rows across every account — what an empty selection shows. */
  total: number;
}) {
  const { t } = useTranslation();
  // One account in the data means nothing to choose between; the label on the
  // rows already answers "whose is this".
  if (options.length < 2) return null;

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((entry) => entry !== id) : [...value, id]);

  const label =
    value.length === 0
      ? t("accountFilter.all", { count: total })
      : value.length === 1
        ? (options.find((option) => option.id === value[0])?.name ?? t("accountFilter.label"))
        : t("accountFilter.some", { count: value.length });

  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {t("accountFilter.label")}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-9 min-w-[200px] justify-between text-xs">
            <span className="truncate">{label}</span>
            <ChevronDown className="size-3.5 shrink-0 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-[320px] w-[260px] overflow-y-auto">
          <DropdownMenuItem
            className="text-xs"
            onSelect={(event) => {
              // Keep the menu open: clearing is usually followed by picking.
              event.preventDefault();
              onChange([]);
            }}
          >
            {value.length === 0 && <Check className="size-3.5" />}
            {t("accountFilter.all", { count: total })}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {options.map((option) => (
            <DropdownMenuCheckboxItem
              key={option.id}
              checked={value.includes(option.id)}
              onCheckedChange={() => toggle(option.id)}
              onSelect={(event) => event.preventDefault()}
              className="text-xs"
            >
              <span className="truncate">{option.name}</span>
              <span className="ml-auto pl-2 tabular-nums text-muted-foreground">
                {option.count}
              </span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
