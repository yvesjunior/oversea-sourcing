// Integrity of the category taxonomy (ADR-001 S1) — ids are persisted on
// requests and used as cache/coverage keys, so structural breakage must fail
// the suite, not surface in production data.

import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  categoryById,
  categoryLabel,
  childrenOf,
  rootCategories,
  suggestCategory,
} from "./taxonomy";

describe("taxonomy integrity", () => {
  it("has unique, stable-format ids", () => {
    const ids = CATEGORIES.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("every child references an existing sector", () => {
    for (const node of CATEGORIES) {
      if (node.parent === null) continue;
      const parent = categoryById(node.parent);
      expect(parent, `${node.id} → ${node.parent}`).toBeDefined();
      expect(parent!.parent).toBeNull(); // two levels only
    }
  });

  it("every node carries both labels, HS mapping and keywords", () => {
    for (const node of CATEGORIES) {
      expect(node.fr.length).toBeGreaterThan(1);
      expect(node.en.length).toBeGreaterThan(1);
      expect(node.hs.length).toBeGreaterThan(0);
      for (const hs of node.hs) expect(hs).toMatch(/^\d{2}(\d{2})?$/);
      expect(node.keywords.length).toBeGreaterThan(0);
      // Keywords are the normalized vocabulary: lowercase, unaccented.
      for (const kw of node.keywords)
        expect(kw).toBe(kw.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase());
    }
  });

  it("is in the target size band and every sector has children or stands alone deliberately", () => {
    expect(CATEGORIES.length).toBeGreaterThanOrEqual(50);
    expect(CATEGORIES.length).toBeLessThanOrEqual(120);
    for (const sector of rootCategories()) {
      expect(childrenOf(sector.id).length, `sector ${sector.id} has no children`).toBeGreaterThan(
        0,
      );
    }
  });
});

describe("category labels", () => {
  it("localizes and prefixes children with their sector", () => {
    expect(categoryLabel("valves", "fr")).toBe("Fluides & robinetterie — Vannes & robinetterie");
    expect(categoryLabel("valves", "en")).toBe("Fluid handling — Valves");
    expect(categoryLabel("fluid", "en")).toBe("Fluid handling");
    expect(categoryLabel("unknown-id", "fr")).toBe("unknown-id");
  });
});

describe("suggestCategory", () => {
  it("maps the classic field wordings to the right node", () => {
    expect(suggestCategory("vannes papillon inox sanitaires DN50")?.id).toBe("valves");
    expect(suggestCategory("hydraulic pumps 16 bar stainless")?.id).toBe("pumps");
    expect(suggestCategory("cartons ondulés pour caisses d'expédition")?.id).toBe(
      "corrugated-boxes",
    );
    expect(suggestCategory("injection molding of ABS enclosures")?.id).toBe("injection-molding");
  });

  it("returns null when the text carries no signal", () => {
    expect(suggestCategory("hello there general request")).toBeNull();
    expect(suggestCategory("")).toBeNull();
  });
});
