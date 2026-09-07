// The registry is what drives the preferences panel AND the emitter's channel
// check, so two invariants are worth holding down by test rather than by care.

import { describe, expect, it } from "vitest";
import fr from "@/i18n/locales/fr.json";
import en from "@/i18n/locales/en.json";
import {
  channelEnabled,
  isKnownNotificationType,
  NOTIFICATION_TYPES,
} from "@/lib/notification-types";

describe("every notification type is labelled in both languages", () => {
  // Paramètres → Notifications renders t(`settings.notifTypes.${type}`) with no
  // defaultValue, so a missing label shows the raw key to the user. Three of
  // them did exactly that from 2026-08-26 to 2026-09-07.
  it.each(NOTIFICATION_TYPES.map((e) => e.type))("%s has a prefs-panel label", (type) => {
    expect(fr.settings.notifTypes).toHaveProperty(type);
    expect(en.settings.notifTypes).toHaveProperty(type);
  });

  it.each(NOTIFICATION_TYPES.map((e) => e.type))("%s has a bell label", (type) => {
    expect(fr.notifications).toHaveProperty(type);
    expect(en.notifications).toHaveProperty(type);
  });
});

describe("channelEnabled defaults to ON", () => {
  it("treats a missing row, type or flag as enabled", () => {
    // A new type is never born muted — the default is today's behaviour.
    expect(channelEnabled(null, "quotes_requested", "email")).toBe(true);
    expect(channelEnabled({}, "quotes_requested", "inApp")).toBe(true);
    expect(channelEnabled({ quotes_requested: {} }, "quotes_requested", "email")).toBe(true);
  });

  it("only false silences a channel", () => {
    expect(
      channelEnabled({ quotes_requested: { email: false } }, "quotes_requested", "email"),
    ).toBe(false);
    // …and silencing one channel leaves the other alone.
    expect(
      channelEnabled({ quotes_requested: { email: false } }, "quotes_requested", "inApp"),
    ).toBe(true);
  });
});

describe("isKnownNotificationType", () => {
  it("accepts the staff alert and rejects a typo", () => {
    expect(isKnownNotificationType("quotes_requested")).toBe(true);
    expect(isKnownNotificationType("quote_requested")).toBe(false);
  });
});
