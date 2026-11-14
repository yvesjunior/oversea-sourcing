// Platform settings (Phase V · V01, 2026-11-14) — one value per key, for
// every client. The registry in src/lib/platform-settings.ts decides what a
// key is; this page only renders it. NOT /parametres, which is the buyer's.

import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requirePlatformFeature } from "@/lib/auth-guard";
import { formatDayTime } from "@/lib/instant";
import {
  bpsToPercent,
  isUnavailableOption,
  PLATFORM_SETTINGS,
  SETTING_GROUPS,
  type SettingKey,
} from "@/lib/platform-settings";
import {
  getPlatformSettingsFn,
  updatePlatformSettingFn,
  type PlatformSettingsData,
  type SettingView,
} from "@/lib/platform-settings-fns";

export const Route = createFileRoute("/interne/parametres")({
  beforeLoad: ({ context }) => requirePlatformFeature(context.session, "settings"),
  head: () => ({
    meta: [{ title: "Paramètres de la plateforme | OSI" }, { name: "robots", content: "noindex" }],
  }),
  loader: async (): Promise<PlatformSettingsData> => await getPlatformSettingsFn(),
  component: PlatformSettings,
});

function SettingRow({ setting, onSaved }: { setting: SettingView; onSaved: () => void }) {
  const { t, i18n } = useTranslation();
  const definition = PLATFORM_SETTINGS[setting.key];
  const [draft, setDraft] = useState<number | string>(setting.value);
  const [saving, setSaving] = useState(false);
  const [refused, setRefused] = useState(false);

  const dirty = draft !== setting.value;
  const id = `setting-${setting.key}`;

  const save = async () => {
    setSaving(true);
    setRefused(false);
    try {
      const result = await updatePlatformSettingFn({ data: { key: setting.key, value: draft } });
      if (result.ok) onSaved();
      else setRefused(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border-t border-border py-4 last:pb-0">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor={id} className="text-sm font-semibold">
              {t(`platformSettings.keys.${setting.key}`)}
            </Label>
            {definition.inert ? (
              <span
                title={t("platformSettings.inertHint")}
                className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {t("platformSettings.inert")}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {t(`platformSettings.hints.${setting.key}`)}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {definition.kind === "integer" ? (
            <>
              <Input
                id={id}
                type="number"
                min={definition.min}
                max={definition.max}
                step={1}
                value={draft}
                onChange={(e) => {
                  setRefused(false);
                  setDraft(Number(e.target.value));
                }}
                className="h-8 w-24 text-right tabular-nums"
              />
              <span className="w-28 text-xs text-muted-foreground">
                {t(`platformSettings.units.${definition.unit}`)}
              </span>
            </>
          ) : (
            <select
              id={id}
              value={draft}
              onChange={(e) => {
                setRefused(false);
                setDraft(e.target.value);
              }}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            >
              {definition.options.map((option) => {
                const unavailable = isUnavailableOption(definition, option);
                return (
                  <option key={option} value={option} disabled={unavailable}>
                    {t(`platformSettings.options.${option}`)}
                    {unavailable ? ` — ${t("platformSettings.optionSoon")}` : ""}
                  </option>
                );
              })}
            </select>
          )}
          <Button size="sm" disabled={!dirty || saving} onClick={() => void save()}>
            {t("platformSettings.save")}
          </Button>
        </div>
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground">
        {definition.kind === "integer" ? (
          <>
            {t("platformSettings.range", { min: definition.min, max: definition.max })}
            {definition.unit === "bps" && typeof draft === "number" ? (
              <>
                {" · "}
                <span className="font-semibold text-foreground">
                  {t("platformSettings.percent", {
                    percent: bpsToPercent(draft).toLocaleString(i18n.language, {
                      maximumFractionDigits: 2,
                    }),
                  })}
                </span>
              </>
            ) : null}
            {" · "}
          </>
        ) : null}
        {setting.updatedAt
          ? t("platformSettings.lastChangedBy", {
              name: setting.updatedByName ?? "—",
              date: formatDayTime(setting.updatedAt, i18n.language),
            })
          : t("platformSettings.usingDefault")}
      </p>
      {refused ? (
        <p role="alert" className="mt-1 text-[11px] font-medium text-destructive">
          {t("platformSettings.refused")}
        </p>
      ) : null}
    </div>
  );
}

function PlatformSettings() {
  const { t } = useTranslation();
  const router = useRouter();
  const { settings } = Route.useLoaderData();
  const refresh = () => void router.invalidate();
  const byKey = new Map<SettingKey, SettingView>(settings.map((s) => [s.key, s]));

  return (
    <div className="space-y-6 pt-6">
      <header>
        <h1 className="font-display text-2xl font-semibold">{t("platformSettings.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("platformSettings.subtitle")}</p>
      </header>

      {SETTING_GROUPS.map((group) => {
        const rows = settings.filter((s) => PLATFORM_SETTINGS[s.key].group === group);
        if (rows.length === 0) return null;
        return (
          <section key={group} className="card-surface p-5">
            <h2 className="mb-4 text-base font-bold">{t(`platformSettings.groups.${group}`)}</h2>
            {rows.map((row) => {
              const current = byKey.get(row.key) ?? row;
              // Keyed on the stored value so a save resets the draft to what
              // the server now holds, rather than to what was typed.
              return (
                <SettingRow
                  key={`${row.key}:${String(current.value)}:${current.updatedAt ?? ""}`}
                  setting={current}
                  onSaved={refresh}
                />
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
