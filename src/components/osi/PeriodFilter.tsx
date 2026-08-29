// Narrow a list to a period — this week, this month, this year, or a range
// you pick (owner, 2026-08-29).
//
// The presets answer the question people actually ask ("what came in this
// week?"); the custom range is there for the one they ask afterwards ("what
// about the two weeks around the trade show?"). Both resolve to the same
// inclusive pair of CIVIL DATES in OSI's zone — see src/lib/period.ts for why
// that, and not instants, is what a calendar question compares.

import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  normalizeRange,
  periodRange,
  PERIOD_KEYS,
  type DateRange,
  type PeriodKey,
} from "@/lib/period";

/** Resolve the control's state to the range a list should filter by. */
export function resolvePeriod(
  key: PeriodKey,
  custom: DateRange,
  now: Date = new Date(),
): DateRange {
  return key === "custom" ? normalizeRange(custom) : periodRange(key, now);
}

export function PeriodFilter({
  value,
  onChange,
  custom,
  onCustomChange,
}: {
  value: PeriodKey;
  onChange: (value: PeriodKey) => void;
  custom: DateRange;
  onCustomChange: (range: DateRange) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {t("periodFilter.label")}
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        {PERIOD_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              value === key
                ? "border-transparent bg-gold-gradient text-gold-foreground shadow-gold"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {t(`periodFilter.${key}`)}
          </button>
        ))}
      </div>
      {/* The date inputs appear only for the choice that needs them, rather
          than sitting empty and inert beside the presets. */}
      {value === "custom" && (
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            aria-label={t("periodFilter.from")}
            value={custom.from ?? ""}
            onChange={(event) => onCustomChange({ ...custom, from: event.target.value || null })}
            className="h-9 w-[150px] text-xs"
          />
          <span className="text-xs text-muted-foreground">→</span>
          <Input
            type="date"
            aria-label={t("periodFilter.to")}
            value={custom.to ?? ""}
            onChange={(event) => onCustomChange({ ...custom, to: event.target.value || null })}
            className="h-9 w-[150px] text-xs"
          />
        </div>
      )}
    </div>
  );
}
