// Every audit action the code can emit must be labelled in both languages.
//
// AuditJournal renders t(`auditActions.${row.action}`, { defaultValue: row.action }),
// so a missing label does not fail — it prints the raw dot-code at the reader.
// Four actions shipped that way (deal.opened, contract.sent, role.created,
// role.deleted) and nobody noticed until the journal was opened on purpose.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import fr from "@/i18n/locales/fr.json";
import en from "@/i18n/locales/en.json";

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (full.endsWith(".ts") && !full.endsWith(".test.ts")) found.push(full);
  }
  return found;
}

/**
 * Action codes passed to logAudit. Covers the plain form and the ternary the
 * toggle-shaped fns use (`data.enabled ? "source.enabled" : "source.disabled"`),
 * which is why this scans for the codes rather than the call shape.
 */
function emittedActions(): string[] {
  const codes = new Set<string>();
  for (const file of sourceFiles("src")) {
    const text = readFileSync(file, "utf8");
    if (!text.includes("logAudit")) continue;
    for (const block of text.matchAll(/logAudit\(\{(.*?)\n\s*\}\)/gs)) {
      const line = /action:\s*(.+?),\n/s.exec(block[1] ?? "");
      if (!line) continue;
      for (const literal of (line[1] ?? "").matchAll(/"([a-z_]+(?:\.[a-z_]+)+)"/g)) {
        codes.add(literal[1] as string);
      }
    }
  }
  return [...codes].sort();
}

const ACTIONS = emittedActions();

describe("audit action labels", () => {
  it("finds the emitters at all (guards the scanner itself)", () => {
    // If a refactor changes the call shape, the scan silently passes with an
    // empty set and this file stops protecting anything.
    expect(ACTIONS.length).toBeGreaterThan(20);
    expect(ACTIONS).toContain("request.created");
    expect(ACTIONS).toContain("contract.signed");
  });

  it.each(ACTIONS)("%s is labelled in French", (action) => {
    expect(fr.auditActions).toHaveProperty(action);
  });

  it.each(ACTIONS)("%s is labelled in English", (action) => {
    expect(en.auditActions).toHaveProperty(action);
  });
});
