// Data-driven labels: every code the app can EMIT must be labelled in both
// locales.
//
// This is the one class of i18n bug the locale files cannot show you. They are
// identical to each other — 916 keys, zero drift — so a parity test passes
// while the screen prints a raw key, because the failure is always "the code
// emits a key that exists in NEITHER file". Four shipped that way in a week:
// the dashboard feed, the notification preferences panel, the audit journal,
// and `quote.accepted` on a buyer's own dossier.
//
// So the test works the other way round: it reads the SOURCE for the codes
// that reach a `t(`namespace.${code}`)` lookup, and asserts a label exists.
// Adding an emitter without a label fails here instead of on a user's screen.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import fr from "@/i18n/locales/fr.json";
import en from "@/i18n/locales/en.json";
import { CONTRACT_STATUSES, CONTRACT_TYPES, QUOTE_STATUSES } from "@/database/schema";
import { NOTIFICATION_TYPES } from "@/lib/notification-types";

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (full.endsWith(".ts") && !full.endsWith(".test.ts")) found.push(full);
  }
  return found;
}

const SOURCES = sourceFiles("src").map((f) => ({ file: f, text: readFileSync(f, "utf8") }));

/** Every distinct capture of `pattern` across the non-test sources. */
function emitted(pattern: RegExp): string[] {
  const codes = new Set<string>();
  for (const { text } of SOURCES) {
    for (const m of text.matchAll(pattern)) if (m[1]) codes.add(m[1]);
  }
  return [...codes].sort();
}

/**
 * Sections disagree on punctuation and that is fine — `auditActions` keeps the
 * dots ("workspace.renamed"), `events` and `contrats.event` swap them for
 * underscores ("quotes_requested"), because each renderer decides. The test
 * accepts either rather than imposing a convention it would then have to
 * enforce across 900 existing keys.
 */
function labelled(section: Record<string, string>, code: string): boolean {
  return [code, code.replace(/\./g, "_")].some(
    (key) =>
      key in section ||
      // i18next resolves `x` through `x_one` / `x_other` when a count is passed.
      `${key}_one` in section ||
      `${key}_other` in section,
  );
}

const REGISTRIES: {
  name: string;
  codes: string[];
  fr: Record<string, string>;
  en: Record<string, string>;
}[] = [
  {
    name: "audit actions (auditActions.*)",
    codes: emitted(/logAudit\(\{[^}]*?action:[^\n]*?"([a-z_]+(?:\.[a-z_]+)+)"/gs),
    fr: fr.auditActions,
    en: en.auditActions,
  },
  {
    name: "request + deal event types (events.*)",
    codes: emitted(/record(?:Deal)?Event\([^,]+,\s*[^,]+,\s*"([a-z_.]+)"/g),
    fr: fr.events,
    en: en.events,
  },
  {
    name: "contract event types (contrats.event.*)",
    codes: emitted(/type:\s*"(contract\.[a-z_]+)"/g),
    fr: fr.contrats.event,
    en: en.contrats.event,
  },
  {
    name: "notification types (notifications.* and settings.notifTypes.*)",
    codes: NOTIFICATION_TYPES.map((entry) => entry.type),
    fr: fr.notifications,
    en: en.notifications,
  },
  {
    name: "notification types in the preferences panel",
    codes: NOTIFICATION_TYPES.map((entry) => entry.type),
    fr: fr.settings.notifTypes,
    en: en.settings.notifTypes,
  },
  {
    name: "quote statuses (soumissions.*)",
    codes: [...QUOTE_STATUSES],
    fr: fr.soumissions,
    en: en.soumissions,
  },
  {
    name: "contract statuses (contrats.status.*)",
    codes: [...CONTRACT_STATUSES],
    fr: fr.contrats.status,
    en: en.contrats.status,
  },
  {
    name: "contract types (contrats.type.*)",
    codes: [...CONTRACT_TYPES],
    fr: fr.contrats.type,
    en: en.contrats.type,
  },
];

describe("the scanner itself", () => {
  // A refactor of a call shape would otherwise turn a registry into an empty
  // list, and an empty list passes every assertion below in silence.
  it.each(REGISTRIES.map((r) => [r.name, r.codes.length] as const))(
    "%s found codes to check (%i)",
    (_name, count) => {
      expect(count).toBeGreaterThan(0);
    },
  );

  it("recognises the codes that actually broke", () => {
    const audit = REGISTRIES[0]?.codes ?? [];
    const events = REGISTRIES[1]?.codes ?? [];
    expect(audit).toContain("contract.signed");
    expect(events).toContain("quote.accepted");
  });
});

describe.each(REGISTRIES)("$name", ({ codes, fr: frSection, en: enSection }) => {
  it.each(codes)("%s is labelled in French", (code) => {
    expect(labelled(frSection, code)).toBe(true);
  });

  it.each(codes)("%s is labelled in English", (code) => {
    expect(labelled(enSection, code)).toBe(true);
  });
});
