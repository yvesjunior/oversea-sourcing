// Platform settings — server fns for /interne/parametres (Phase V · V01).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  defaultSetting,
  isSettingKey,
  parseSettingValue,
  resolveSetting,
  SETTING_KEYS,
  type PlatformSettingValues,
  type SettingKey,
} from "@/lib/platform-settings";

export type SettingView = {
  key: SettingKey;
  value: PlatformSettingValues[SettingKey];
  defaultValue: PlatformSettingValues[SettingKey];
  /** Null while the key has never been set — it is running on its default. */
  updatedAt: string | null;
  updatedByName: string | null;
};

export type PlatformSettingsData = { settings: SettingView[] };

const EMPTY: PlatformSettingsData = { settings: [] };

/** Owner by default — the gate lives in src/lib/roles.ts (`settings`). */
async function requireSettingsAdmin() {
  const [{ auth }, { getRequest }] = await Promise.all([
    import("@/server/auth"),
    import("@tanstack/react-start/server"),
  ]);
  const session = await auth.api.getSession({ headers: getRequest().headers });
  if (!session) return null;
  // Staff powers only from the internal workspace (2026-08-27).
  const { effectiveHasPermission } = await import("@/server/workspace-guard");
  if (!(await effectiveHasPermission(session, "settings"))) return null;
  return session;
}

export const getPlatformSettingsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<PlatformSettingsData> => {
    const session = await requireSettingsAdmin();
    if (!session) return EMPTY;

    const { getSettingRows } = await import("@/server/platform-settings");
    const rows = await getSettingRows();
    return {
      // Registry order, not table order: a key with no row still has a line.
      settings: SETTING_KEYS.map((key) => {
        const row = rows.get(key);
        return {
          key,
          value: resolveSetting(key, row?.value),
          defaultValue: defaultSetting(key),
          updatedAt: row ? row.updatedAt.toISOString() : null,
          updatedByName: row?.updatedByName ?? null,
        };
      }),
    };
  },
);

export type UpdateSettingResult =
  { ok: true } | { ok: false; reason: "forbidden" | "unknown_key" | "invalid_value" };

export const updatePlatformSettingFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      key: z.string().min(1).max(64),
      // The registry decides what is valid for the key; this only bounds the
      // shape so nothing structured can be stored under a scalar setting.
      value: z.union([z.number(), z.string().max(64)]),
    }),
  )
  .handler(async ({ data }): Promise<UpdateSettingResult> => {
    const session = await requireSettingsAdmin();
    if (!session) return { ok: false, reason: "forbidden" };
    // An unknown key is refused, never stored: a typo must not create a row
    // that every reader then ignores in silence.
    if (!isSettingKey(data.key)) return { ok: false, reason: "unknown_key" };
    const parsed = parseSettingValue(data.key, data.value);
    if (!parsed.ok) return { ok: false, reason: "invalid_value" };

    const { setSetting } = await import("@/server/platform-settings");
    const { previous } = await setSetting(data.key, parsed.value, {
      id: session.user.id,
      name: session.user.name,
    });
    // Saving the value already in force is not a change, and a journal that
    // records non-events teaches people to stop reading it.
    if (previous !== parsed.value) {
      const { logAudit, actorOf } = await import("@/server/audit");
      await logAudit({
        ...actorOf(session),
        action: "platform_setting.updated",
        target: data.key,
        detail: { from: previous, to: parsed.value },
      });
    }
    return { ok: true };
  });
