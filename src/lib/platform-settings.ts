// Platform settings — the REGISTRY (Phase V · V01, 2026-11-14).
//
// Pure and client-safe: no server imports. The impure side (reading and
// writing the `platform_setting` table) lives in src/server/platform-settings.ts.
//
// One value per key, for every client — the owner asked for the Decision
// Pack's release mode to be a setting in OSI's own Paramètres, "unique,
// applicable à toutes" (2026-10-22). This file is what makes a setting real:
// its type, its range, its default. A key that is not here cannot be stored,
// and a stored value that no longer fits reads as the default.

import { z } from "zod";

/** How a Decision Pack reaches the buyer. `manual` = staff validate and send
 *  (the default, owner 2026-10-22); `automatic` is designed in from the start
 *  and switched on later — see `unavailable` below. */
export const RELEASE_MODES = ["manual", "automatic"] as const;
export type ReleaseMode = (typeof RELEASE_MODES)[number];

/** The value type of every setting. Adding a key starts here. */
export type PlatformSettingValues = {
  "rfq.window_hours": number;
  "rfq.target_offers": number;
  "pack.release_mode": ReleaseMode;
  "fee.rate_bps": number;
};
export type SettingKey = keyof PlatformSettingValues;

type IntegerDefinition = {
  kind: "integer";
  min: number;
  max: number;
  default: number;
  unit: "hours" | "offers" | "bps";
};
type ChoiceDefinition<T extends string> = {
  kind: "choice";
  options: readonly T[];
  default: T;
  /** Options that exist in the type but that nothing implements yet. They are
   *  shown greyed and REFUSED by the server: a mode that can be selected
   *  before the code honours it would switch itself on the day its reader
   *  ships, with nobody having decided to. */
  unavailable: readonly T[];
};
type Common = {
  group: SettingGroup;
  /**
   * True while NOTHING in the product reads this setting.
   *
   * The house rule for the schema is that a column nobody writes is worse
   * than a missing one, because it reads as a capability. A setting nobody
   * reads is the same trap with a form on top: the owner changes a number,
   * nothing happens, and the page lied. So the page says it plainly, and the
   * task that makes a key real flips this to false in the same commit.
   */
  inert: boolean;
};
// `[V] extends [number]`, not `V extends number`: a bare conditional
// distributes over a union, which would turn a choice between two modes into
// "a choice of one mode, or a choice of the other".
export type SettingDefinition<V> = Common &
  ([V] extends [number] ? IntegerDefinition : ChoiceDefinition<V & string>);

export const SETTING_GROUPS = ["rfq", "pack", "fee"] as const;
export type SettingGroup = (typeof SETTING_GROUPS)[number];

export const PLATFORM_SETTINGS: {
  [K in SettingKey]: SettingDefinition<PlatformSettingValues[K]>;
} = {
  /** How long suppliers have to answer, counted from the batch leaving
   *  (`quote.sent_at`, never `requested_at` — README §2c). Read by V06. */
  "rfq.window_hours": {
    kind: "integer",
    group: "rfq",
    min: 1,
    max: 720,
    default: 72,
    unit: "hours",
    inert: true,
  },
  /**
   * How many OFFERS close a window early.
   *
   * NOT `plan.suppliers_returned` and not the `SUPPLIERS_RETURNED` env var:
   * those say how many suppliers the search ranks. All three default to 5,
   * which is exactly why they will be confused. Read by V07.
   */
  "rfq.target_offers": {
    kind: "integer",
    group: "rfq",
    min: 1,
    max: 20,
    default: 5,
    unit: "offers",
    inert: true,
  },
  /** Read by V07 (manual) and V14 (automatic). */
  "pack.release_mode": {
    kind: "choice",
    group: "pack",
    options: RELEASE_MODES,
    default: "manual",
    unavailable: ["automatic"],
    inert: true,
  },
  /**
   * OSI's fee, in basis points of the transaction amount, added on top
   * (owner, 2026-10-25: 3 %, configurable). Basis points and not a percentage
   * so the stored value is an integer — money here is never a float.
   *
   * STORED AND SHOWN, APPLIED BY NOTHING until the settlement slice clears
   * its legal gate (README §2c: for anything financial, do not build it yet).
   */
  "fee.rate_bps": {
    kind: "integer",
    group: "fee",
    min: 0,
    max: 2000,
    default: 300,
    unit: "bps",
    inert: true,
  },
};

export const SETTING_KEYS = Object.keys(PLATFORM_SETTINGS) as SettingKey[];

export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(PLATFORM_SETTINGS, key);
}

/** The zod schema a value must pass to be STORED. Unavailable options fail. */
function writeSchema(key: SettingKey): z.ZodType {
  const definition = PLATFORM_SETTINGS[key];
  if (definition.kind === "integer") {
    return z.number().int().min(definition.min).max(definition.max);
  }
  const allowed = definition.options.filter((option) => !definition.unavailable.includes(option));
  return z.string().refine((value) => (allowed as readonly string[]).includes(value));
}

/** The schema a STORED value must pass to be read back. Wider than
 *  `writeSchema` on purpose: an option that was available when it was stored
 *  must not silently turn into the default if it is later withdrawn — that
 *  is a decision, and it belongs to whoever withdraws the option. */
function readSchema(key: SettingKey): z.ZodType {
  const definition = PLATFORM_SETTINGS[key];
  if (definition.kind === "integer") {
    return z.number().int().min(definition.min).max(definition.max);
  }
  return z.string().refine((value) => (definition.options as readonly string[]).includes(value));
}

export type ParsedSetting<K extends SettingKey> =
  { ok: true; value: PlatformSettingValues[K] } | { ok: false };

/** Validate a value someone wants to STORE under `key`. */
export function parseSettingValue<K extends SettingKey>(key: K, raw: unknown): ParsedSetting<K> {
  const parsed = writeSchema(key).safeParse(raw);
  return parsed.success
    ? { ok: true, value: parsed.data as PlatformSettingValues[K] }
    : { ok: false };
}

export function defaultSetting<K extends SettingKey>(key: K): PlatformSettingValues[K] {
  return PLATFORM_SETTINGS[key].default as PlatformSettingValues[K];
}

/** What a reader gets: the stored value when it still fits the registry, the
 *  default when there is no row or the row no longer makes sense. */
export function resolveSetting<K extends SettingKey>(
  key: K,
  stored: unknown,
): PlatformSettingValues[K] {
  if (stored === undefined || stored === null) return defaultSetting(key);
  const parsed = readSchema(key).safeParse(stored);
  return parsed.success ? (parsed.data as PlatformSettingValues[K]) : defaultSetting(key);
}

/** 300 → 3, 250 → 2.5. For display only — nothing computes with the result. */
export function bpsToPercent(bps: number): number {
  return bps / 100;
}
