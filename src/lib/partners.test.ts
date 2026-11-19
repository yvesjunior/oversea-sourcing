import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import fr from "@/i18n/locales/fr.json";
import en from "@/i18n/locales/en.json";
import {
  PARTNER_KINDS,
  PARTNER_KINDS_AVAILABLE,
  PARTNER_PROVIDERS,
  partnerKindAvailable,
} from "@/lib/partners";

describe("partner kinds", () => {
  it("are the five slots of a dossier", () => {
    expect([...PARTNER_KINDS].sort()).toEqual(
      ["customs", "inspection", "insurance", "settlement", "transport"].sort(),
    );
  });

  // The money circuit waits on its legal opinion (README §2c): a settlement
  // partner on file would read as a capability the platform does not have.
  it("cannot be created as settlement until the legal gate lifts", () => {
    expect(partnerKindAvailable("settlement")).toBe(false);
    for (const kind of ["transport", "inspection", "customs", "insurance"] as const) {
      expect(partnerKindAvailable(kind)).toBe(true);
    }
    expect(PARTNER_KINDS_AVAILABLE.every((kind) => PARTNER_KINDS.includes(kind))).toBe(true);
  });

  it("each have a name in both languages", () => {
    for (const locale of [fr, en]) {
      const names = locale.partnersAdmin.kind as Record<string, string>;
      for (const kind of PARTNER_KINDS) expect(names[kind], kind).toBeTypeOf("string");
    }
  });
});

// "No domain code imports a provider directly — only the adapter" (V21), the
// rule mail.ts and esign.ts already follow. Checked on the source: an import
// of a provider from anywhere else is how a seam stops being one.
describe("the partner adapter is the only way to a provider", () => {
  function sources(dir: string, found: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) sources(full, found);
      else if (/\.tsx?$/.test(full) && !/\.test\.tsx?$/.test(full)) found.push(full);
    }
    return found;
  }
  const files = sources("src").map((file) => ({
    file: file.replaceAll("\\", "/"),
    text: readFileSync(file, "utf8"),
  }));

  it("has one provider file per provider, beside the adapter", () => {
    const providerFiles = files
      .map(({ file }) => file)
      .filter((file) => file.startsWith("src/server/partners/") && !file.endsWith("/adapter.ts"))
      .map((file) => file.replace("src/server/partners/", "").replace(".ts", ""));
    expect(providerFiles.sort()).toEqual([...PARTNER_PROVIDERS].sort());
  });

  it("lets nothing but the adapter import a provider", () => {
    const offenders = files
      .filter(({ file }) => file !== "src/server/partners/adapter.ts")
      .filter(({ text }) =>
        PARTNER_PROVIDERS.some((provider) =>
          new RegExp(
            `from "(@/server/partners|\\.)/${provider}"|import\\("@/server/partners/${provider}"\\)`,
          ).test(text),
        ),
      )
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});
