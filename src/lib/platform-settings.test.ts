import { describe, expect, it } from "vitest";
import fr from "@/i18n/locales/fr.json";
import en from "@/i18n/locales/en.json";
import {
  bpsToPercent,
  defaultSetting,
  isSettingKey,
  parseSettingValue,
  PLATFORM_SETTINGS,
  resolveSetting,
  SETTING_GROUPS,
  SETTING_KEYS,
} from "@/lib/platform-settings";

describe("the registry", () => {
  it("ships the four settings Phase V starts with, at the owner's values", () => {
    expect(defaultSetting("rfq.window_hours")).toBe(72);
    expect(defaultSetting("rfq.target_offers")).toBe(5);
    expect(defaultSetting("pack.release_mode")).toBe("manual");
    // 3 % (owner, 2026-10-25), stored as basis points.
    expect(defaultSetting("fee.rate_bps")).toBe(300);
    expect(bpsToPercent(defaultSetting("fee.rate_bps"))).toBe(3);
  });

  it("gives every key a default that its own rules accept", () => {
    for (const key of SETTING_KEYS) {
      expect(parseSettingValue(key, defaultSetting(key)), key).toEqual({
        ok: true,
        value: defaultSetting(key),
      });
    }
  });

  it("puts every key in a known group", () => {
    for (const key of SETTING_KEYS) {
      expect(SETTING_GROUPS, key).toContain(PLATFORM_SETTINGS[key].group);
    }
  });

  it("knows its own keys and nothing else", () => {
    expect(isSettingKey("rfq.window_hours")).toBe(true);
    expect(isSettingKey("rfq.window_minutes")).toBe(false);
    // Inherited names must not pass for settings.
    expect(isSettingKey("constructor")).toBe(false);
    expect(isSettingKey("toString")).toBe(false);
  });
});

describe("storing a value", () => {
  it("accepts an integer inside the range", () => {
    expect(parseSettingValue("rfq.window_hours", 48)).toEqual({ ok: true, value: 48 });
    expect(parseSettingValue("fee.rate_bps", 0)).toEqual({ ok: true, value: 0 });
  });

  it("refuses what is out of range, fractional, or the wrong type", () => {
    expect(parseSettingValue("rfq.window_hours", 0).ok).toBe(false);
    expect(parseSettingValue("rfq.window_hours", 721).ok).toBe(false);
    expect(parseSettingValue("rfq.window_hours", 1.5).ok).toBe(false);
    expect(parseSettingValue("rfq.window_hours", "72").ok).toBe(false);
    expect(parseSettingValue("rfq.target_offers", 21).ok).toBe(false);
    expect(parseSettingValue("pack.release_mode", 1).ok).toBe(false);
    expect(parseSettingValue("pack.release_mode", "weekly").ok).toBe(false);
  });

  // The mode exists in the type so the code can be written for it, but nothing
  // releases a pack automatically yet (Phase V · V14). A mode that could be
  // selected before its reader ships would switch itself on the day it does.
  it("refuses an option nothing implements yet", () => {
    expect(parseSettingValue("pack.release_mode", "manual")).toEqual({ ok: true, value: "manual" });
    expect(parseSettingValue("pack.release_mode", "automatic").ok).toBe(false);
  });
});

// Switching the pack flow on before slice 1 is complete would strand every
// paying customer's request in `shortlisted` — nothing can move it on yet.
describe("the pack-flow switch", () => {
  it("is off unless a row says otherwise", () => {
    expect(defaultSetting("flow.pack_enabled")).toBe("off");
    expect(resolveSetting("flow.pack_enabled", undefined)).toBe("off");
  });

  it("cannot be switched on from the page or the server fn", () => {
    expect(parseSettingValue("flow.pack_enabled", "off")).toEqual({ ok: true, value: "off" });
    expect(parseSettingValue("flow.pack_enabled", "on").ok).toBe(false);
  });

  // How it is exercised in development: by writing the row.
  it("is honoured when the stored row already says on", () => {
    expect(resolveSetting("flow.pack_enabled", "on")).toBe("on");
  });

  it("is read by the pipeline, so it is not marked inert", () => {
    expect(PLATFORM_SETTINGS["flow.pack_enabled"].inert).toBe(false);
  });
});

// The platform sends from no-reply@. An RFQ with no reply address would invite
// the supplier to answer into a mailbox nobody reads.
describe("the RFQ reply address", () => {
  it("has no default — a guessed address is worse than none", () => {
    expect(defaultSetting("rfq.reply_to")).toBe("");
    expect(resolveSetting("rfq.reply_to", undefined)).toBe("");
  });

  it("stores one address, trimmed and lower-cased", () => {
    expect(parseSettingValue("rfq.reply_to", "  Sourcing@Example.com ")).toEqual({
      ok: true,
      value: "sourcing@example.com",
    });
  });

  it("can be cleared", () => {
    expect(parseSettingValue("rfq.reply_to", "")).toEqual({ ok: true, value: "" });
  });

  it("refuses what is not an address", () => {
    for (const bad of ["sourcing", "sourcing@", "@example.com", "a b@example.com", 42]) {
      expect(parseSettingValue("rfq.reply_to", bad).ok, String(bad)).toBe(false);
    }
  });

  it("is read by the batch send, and so is the window", () => {
    expect(PLATFORM_SETTINGS["rfq.reply_to"].inert).toBe(false);
    expect(PLATFORM_SETTINGS["rfq.window_hours"].inert).toBe(false);
    // Snapshotted onto the round, but nothing closes a round on it before V07.
    expect(PLATFORM_SETTINGS["rfq.target_offers"].inert).toBe(true);
  });
});

describe("reading a value back", () => {
  it("falls back to the default when there is no row", () => {
    expect(resolveSetting("rfq.window_hours", undefined)).toBe(72);
    expect(resolveSetting("rfq.window_hours", null)).toBe(72);
  });

  it("returns what was stored when it still fits", () => {
    expect(resolveSetting("rfq.window_hours", 48)).toBe(48);
    expect(resolveSetting("fee.rate_bps", 250)).toBe(250);
  });

  it("reads a row that no longer makes sense as the default, not as garbage", () => {
    expect(resolveSetting("rfq.window_hours", 100_000)).toBe(72);
    expect(resolveSetting("rfq.window_hours", "soon")).toBe(72);
    expect(resolveSetting("pack.release_mode", { mode: "manual" })).toBe("manual");
  });

  // Withdrawing an option must not silently rewrite what a stored row means.
  it("still reads an option that is no longer selectable", () => {
    expect(resolveSetting("pack.release_mode", "automatic")).toBe("automatic");
  });
});

describe("labels", () => {
  // The page looks these up by key; a missing one prints the raw key.
  it.each([
    ["fr", fr.platformSettings],
    ["en", en.platformSettings],
  ] as const)("every key and group is labelled in %s", (_locale, section) => {
    const keys = section.keys as Record<string, unknown>;
    const hints = section.hints as Record<string, unknown>;
    const groups = section.groups as Record<string, unknown>;
    for (const key of SETTING_KEYS) {
      expect(keys[key], `keys.${key}`).toBeTypeOf("string");
      expect(hints[key], `hints.${key}`).toBeTypeOf("string");
    }
    for (const group of SETTING_GROUPS) {
      expect(groups[group], `groups.${group}`).toBeTypeOf("string");
    }
  });
});
