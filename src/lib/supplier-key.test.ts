// The dedup key is what makes bans sticky and re-collection idempotent — a
// re-encountered company MUST land on the same key however the source spells it.

import { describe, expect, it } from "vitest";
import { supplierDedupKey } from "@/lib/supplier-key";

describe("supplierDedupKey", () => {
  it("normalizes case, accents and punctuation to one key", () => {
    const a = supplierDedupKey("Société Générale de Robinetterie", "FR");
    const b = supplierDedupKey("societe generale de robinetterie", "fr");
    const c = supplierDedupKey("SOCIÉTÉ GÉNÉRALE DE ROBINETTERIE.", "Fr");
    expect(a).toBeTruthy();
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("separates the same name in different countries", () => {
    expect(supplierDedupKey("Acme Valves", "FR")).not.toBe(supplierDedupKey("Acme Valves", "CN"));
  });

  it("keeps non-latin names (kanji) instead of reducing them to nothing", () => {
    const key = supplierDedupKey("株式会社 山田製作所", "JP");
    expect(key).not.toBeNull();
    expect(key).toContain("|JP");
    // Same company, different spacing → same key.
    expect(supplierDedupKey("株式会社山田製作所", "JP")).toBe(key);
  });

  it("returns null when the company is not identifiable", () => {
    expect(supplierDedupKey("", "FR")).toBeNull();
    expect(supplierDedupKey("Acme Valves", "")).toBeNull();
  });
});
