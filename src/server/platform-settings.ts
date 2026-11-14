// Platform settings — the impure side (Phase V · V01, 2026-11-14).
//
// The registry (keys, types, ranges, defaults) is src/lib/platform-settings.ts;
// this file only reads and writes the `platform_setting` table.
//
// Reads are cached in-process for a short TTL, like src/server/permissions.ts:
// a setting is read on every round opened and every pack built, and must cost
// nothing. A write busts the cache — IN THIS PROCESS. The worker containers
// are other processes and keep their copy until the TTL runs out, so a change
// made in the web app reaches the pipeline within CACHE_TTL_MS, not instantly.
// That is why anything that must not move under a running job (a round's
// deadline, a dossier's fee) SNAPSHOTS the value when it starts rather than
// reading the setting again later.

import { eq } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import {
  resolveSetting,
  type PlatformSettingValues,
  type SettingKey,
} from "@/lib/platform-settings";

const CACHE_TTL_MS = 30_000;

let cache: { at: number; rows: Map<string, unknown> } | null = null;

async function loadValues(): Promise<Map<string, unknown>> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.rows;
  const rows = new Map<string, unknown>();
  for (const row of await db.select().from(schema.platformSetting)) {
    rows.set(row.key, row.value);
  }
  cache = { at: Date.now(), rows };
  return rows;
}

export function bustSettingsCache(): void {
  cache = null;
}

/** The effective value: the stored one when it fits the registry, else the
 *  default. Never throws on a bad row — a setting must always have an answer. */
export async function getSetting<K extends SettingKey>(key: K): Promise<PlatformSettingValues[K]> {
  const values = await loadValues();
  return resolveSetting(key, values.get(key));
}

export type SettingRow = {
  value: unknown;
  updatedAt: Date;
  updatedByName: string | null;
};

/** Every stored row, uncached — for the admin page, which must show what is
 *  in the table now and who put it there. */
export async function getSettingRows(): Promise<Map<string, SettingRow>> {
  const rows = new Map<string, SettingRow>();
  for (const row of await db.select().from(schema.platformSetting)) {
    rows.set(row.key, {
      value: row.value,
      updatedAt: row.updatedAt,
      updatedByName: row.updatedByName,
    });
  }
  return rows;
}

/**
 * Store `value` under `key` and return what it replaced.
 *
 * The caller has ALREADY validated `value` through `parseSettingValue` — this
 * function does not re-check, so it must never be handed raw input.
 */
export async function setSetting<K extends SettingKey>(
  key: K,
  value: PlatformSettingValues[K],
  actor: { id: string; name: string },
): Promise<{ previous: PlatformSettingValues[K] }> {
  const existing = await db.query.platformSetting.findFirst({
    where: eq(schema.platformSetting.key, key),
  });
  const previous = resolveSetting(key, existing?.value);
  const now = new Date();
  await db
    .insert(schema.platformSetting)
    .values({ key, value, updatedBy: actor.id, updatedByName: actor.name, updatedAt: now })
    .onConflictDoUpdate({
      target: schema.platformSetting.key,
      set: { value, updatedBy: actor.id, updatedByName: actor.name, updatedAt: now },
    });
  bustSettingsCache();
  return { previous };
}
