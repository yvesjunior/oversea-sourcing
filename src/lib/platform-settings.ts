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
 *  (the default, owner 2026-10-22); `automatic` = the pack leaves when its
 *  round closes, without a person (V14) — built, selectable, and left off:
 *  the evidence for switching it is the review report on /interne/packs. */
export const RELEASE_MODES = ["manual", "automatic"] as const;
export type ReleaseMode = (typeof RELEASE_MODES)[number];

/** A plain on/off setting. */
export const SWITCH_VALUES = ["off", "on"] as const;
export type SwitchValue = (typeof SWITCH_VALUES)[number];

/** The value type of every setting. Adding a key starts here. */
export type PlatformSettingValues = {
  "flow.pack_enabled": SwitchValue;
  "rfq.reply_to": string;
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
/** A single email address, or "" for "not set yet". */
type EmailDefinition = { kind: "email"; default: "" };
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
// `string extends V` picks out a free-text value (any string) from a choice
// (a union of literals), which is also a string but not the other way round.
export type SettingDefinition<V> = Common &
  ([V] extends [number]
    ? IntegerDefinition
    : string extends V
      ? EmailDefinition
      : ChoiceDefinition<V & string>);

export const SETTING_GROUPS = ["rfq", "pack", "fee"] as const;
export type SettingGroup = (typeof SETTING_GROUPS)[number];

export const PLATFORM_SETTINGS: {
  [K in SettingKey]: SettingDefinition<PlatformSettingValues[K]>;
} = {
  /**
   * Whether requests take the PACK flow at all (Phase V · V05).
   *
   * `on` → a request whose workspace plan includes quotes forks to
   * `shortlisted` when the search finishes, instead of ending at the Top-N
   * report. `off` → every request ends at the report, as it always has.
   *
   * `on` was UNAVAILABLE while slice 1 was being built (V05–V13): a request
   * reaching `shortlisted` had no way forward, so switching this on would
   * have stranded every paying customer's request there. The slice is
   * complete with V14 and the option is selectable — by the owner, on the
   * settings page. The DEFAULT is still `off`: shipping the code switches
   * nothing on. A request already on the pack flow stays on it if the switch
   * goes back to `off` (its flow is derived from its own history).
   */
  "flow.pack_enabled": {
    kind: "choice",
    group: "pack",
    options: SWITCH_VALUES,
    default: "off",
    unavailable: [],
    inert: false,
  },
  /**
   * Where a supplier's reply to an RFQ goes (V06).
   *
   * The platform sends from no-reply@, so without this an RFQ would invite
   * its reader to answer into a mailbox nobody opens — and the supplier who
   * did answer would be recorded as never having responded. That is why it
   * has NO default and why the batch refuses to leave while it is empty: a
   * guessed address here is worse than a refusal.
   */
  "rfq.reply_to": { kind: "email", group: "rfq", default: "", inert: false },
  /** How long suppliers have to answer, counted from the batch leaving
   *  (README §2c). Snapshotted onto the round when it opens (`sendRfqBatch`),
   *  so changing it never moves a round already open. */
  "rfq.window_hours": {
    kind: "integer",
    group: "rfq",
    min: 1,
    max: 720,
    default: 72,
    unit: "hours",
    inert: false,
  },
  /**
   * How many OFFERS close a window early.
   *
   * NOT `plan.suppliers_returned` and not the `SUPPLIERS_RETURNED` env var:
   * those say how many suppliers the search ranks. All three default to 5,
   * which is exactly why they will be confused. Snapshotted onto the round
   * when it opens (V06) and acted on by `closeRound` (V07): the count is the
   * ROUND's snapshot, so changing this never closes a round already open.
   */
  "rfq.target_offers": {
    kind: "integer",
    group: "rfq",
    min: 1,
    max: 20,
    default: 5,
    unit: "offers",
    inert: false,
  },
  /** Read when a pack is CREATED (V10) and stored on it, so a later change
   *  never alters how a pack already waiting is released. `automatic` is
   *  honoured by `releaseAutomatically` (V14) and so is selectable; it was
   *  refused on write until then. */
  "pack.release_mode": {
    kind: "choice",
    group: "pack",
    options: RELEASE_MODES,
    default: "manual",
    unavailable: [],
    inert: false,
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

/** Is this option one that nothing implements yet? Compared as plain strings:
 *  with more than one choice setting, the definitions form a union whose
 *  option types have nothing in common. */
export function isUnavailableOption(
  definition: { unavailable: readonly string[] },
  option: string,
): boolean {
  return definition.unavailable.includes(option);
}

function selectableOptions(definition: {
  options: readonly string[];
  unavailable: readonly string[];
}): string[] {
  return definition.options.filter((option) => !isUnavailableOption(definition, option));
}

/** "" (not set) or one plausible address. Trimmed and lower-cased on write. */
const emailValue = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .refine((value) => value === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));

/** The zod schema a value must pass to be STORED. Unavailable options fail. */
function writeSchema(key: SettingKey): z.ZodType {
  const definition = PLATFORM_SETTINGS[key];
  if (definition.kind === "integer") {
    return z.number().int().min(definition.min).max(definition.max);
  }
  if (definition.kind === "email") return emailValue;
  const allowed = selectableOptions(definition);
  return z.string().refine((value) => allowed.includes(value));
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
  if (definition.kind === "email") return emailValue;
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
