// Contract conformance for connector #1 (A7): the connector adapts the brief
// to the agent and the agent's candidates to the normalized shape — nothing
// more. The agent itself is mocked; its behavior is not under test here.

import { beforeEach, describe, expect, it, vi } from "vitest";

const agentMock = vi.fn();
vi.mock("@/server/ai/research", () => ({
  researchSuppliers: (...args: unknown[]) => agentMock(...args),
}));

import { globalWebConnector } from "@/server/sources/global-web";
import type { SearchBrief } from "@/server/sources/types";

const BRIEF: SearchBrief = {
  title: "Vannes papillon inox",
  descriptionRaw: "Vannes papillon en acier inoxydable 316L",
  locale: "fr",
  criteria: [{ category: "material", label: "Matériau", value: "316L", unit: null }],
  attachmentText: null,
  countryCodes: ["FR"],
  wanted: 12,
};

// Braces matter: mockReset() returns the mock (a function), and a function
// returned from beforeEach is treated as a teardown hook — vitest would then
// CALL the mock after each test, exploding on throwing implementations.
beforeEach(() => {
  agentMock.mockReset();
});

describe("global_web connector", () => {
  it("declares the meta the registry and catalogue key on", () => {
    expect(globalWebConnector.meta.code).toBe("global_web");
    expect(globalWebConnector.meta.type).toBe("global_web");
  });

  it("passes the brief through — including the country scope", async () => {
    agentMock.mockResolvedValue({ candidates: [], queries: [] });
    await globalWebConnector.collect(BRIEF);
    expect(agentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: BRIEF.title,
        locale: "fr",
        countryCodes: ["FR"],
        criteria: BRIEF.criteria,
      }),
    );
  });

  it("returns candidates in the normalized SourceCandidate shape", async () => {
    agentMock.mockResolvedValue({
      candidates: [
        {
          name: "Robinetterie Lyonnaise",
          descriptor: "Vannes",
          countryCode: "FR",
          website: "robinetterie.fr",
          description: "Fabricant de vannes papillon inox",
          sourceUrl: "https://robinetterie.fr/produits",
          confidence: 72,
        },
      ],
      queries: ["vannes papillon inox fabricant France"],
    });
    const result = await globalWebConnector.collect(BRIEF);
    expect(result.queries).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      name: "Robinetterie Lyonnaise",
      countryCode: "FR",
      confidence: 72,
      sourceUrl: "https://robinetterie.fr/produits",
    });
  });

  it("propagates agent failures (the caller isolates per source)", async () => {
    agentMock.mockImplementation(() => {
      throw new Error("api down");
    });
    const error = await globalWebConnector.collect(BRIEF).then(
      () => null,
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("api down");
  });
});
