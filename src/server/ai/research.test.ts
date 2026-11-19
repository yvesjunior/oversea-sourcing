// The silent-pass guard (2026-09-07). Everything else in the research agent is
// a prompt or an SDK call and is verified against the real API in dev; what
// needs a test is the one control-flow rule that came out of a prod incident:
// a pass that never called web_search is not an answer.
//
// Prod request 3018 (2026-08-30) returned HTTP 200 with a single text block,
// `queries: []`, and marched all the way to report_ready with an empty Top-5.

import { beforeEach, describe, expect, it, vi } from "vitest";

const createMock = vi.fn();
const parseMock = vi.fn();

// Same indirection as global-web.test.ts: the factory is hoisted, so it must
// close over something that exists at module scope rather than the mock itself.
vi.mock("@/server/ai/client", () => ({
  getAnthropic: () => ({
    messages: {
      create: (...args: unknown[]) => createMock(...args),
      parse: (...args: unknown[]) => parseMock(...args),
    },
  }),
  MODEL: "test-research-model",
  EXTRACTION_MODEL: "test-extraction-model",
  RESEARCH_MODEL: {
    id: "test-research-model",
    searchTool: "web_search_20250305" as const,
    price: { input: 1, output: 5 },
    note: "test",
  },
}));

import { NoSearchesError, researchSuppliers, searchModelFor } from "@/server/ai/research";
import { RESEARCH_MODELS } from "@/server/ai/models";

const CTX = {
  title: "dome",
  descriptionRaw: "dome industriel toile pvc",
  locale: "fr",
  criteria: [{ category: "other", label: "Besoin", value: "dome", unit: null }],
};

const USAGE = { input_tokens: 2654, output_tokens: 290 };

/** What 3018 got back: prose, and not one tool call. */
const silentPass = {
  content: [{ type: "text", text: "Voici des fabricants de dômes que je connais…" }],
  stop_reason: "end_turn",
  usage: USAGE,
};

function searchingPass(query: string) {
  return {
    content: [
      { type: "server_tool_use", name: "web_search", input: { query } },
      { type: "web_search_tool_result", content: [] },
      { type: "text", text: "MegaDome Buildings — CA — megadomebuildings.com" },
    ],
    stop_reason: "end_turn",
    usage: USAGE,
  };
}

const ONE_CANDIDATE = {
  parsed_output: {
    suppliers: [
      {
        name: "MegaDome Buildings",
        descriptor: null,
        countryCode: "CA",
        website: "megadomebuildings.com",
        description: "Fabricant de dômes",
        descriptionEn: "Dome manufacturer",
        sourceUrl: "https://megadomebuildings.com",
        confidence: 70,
      },
    ],
  },
};

beforeEach(() => {
  createMock.mockReset();
  parseMock.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("searchPhase — a pass that never searched", () => {
  it("resamples, and returns the retry's work", async () => {
    createMock.mockResolvedValueOnce(silentPass).mockResolvedValueOnce(searchingPass("dome PVC"));
    parseMock.mockResolvedValue(ONE_CANDIDATE);

    const result = await researchSuppliers(CTX);

    expect(createMock).toHaveBeenCalledTimes(2);
    // The silent pass's prose is DISCARDED, not concatenated: it came from the
    // model's memory, and mixing it into the findings would smuggle
    // unevidenced companies into extraction.
    expect(result.queries).toEqual(["dome PVC"]);
    expect(result.candidates).toHaveLength(1);
    expect(parseMock).toHaveBeenCalledTimes(1);
  });

  it("gives up as a named failure, never as an empty answer", async () => {
    createMock.mockResolvedValue(silentPass);

    // The distinction the caller depends on: this must not look like "the web
    // holds nobody for this need", or research_run is marked succeeded and the
    // already-ran guard seals the request for good.
    await expect(researchSuppliers(CTX)).rejects.toThrow(NoSearchesError);
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(parseMock).not.toHaveBeenCalled();
  });

  it("does not resample a pass that did search", async () => {
    createMock.mockResolvedValue(searchingPass("dome PVC"));
    parseMock.mockResolvedValue(ONE_CANDIDATE);

    await researchSuppliers(CTX);

    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("still returns empty — not an error — when searches genuinely found nothing", async () => {
    // Searched, read pages, and the honest answer is that nobody matches.
    // A real empty result must stay distinguishable from a silent pass.
    createMock.mockResolvedValue({
      content: [
        { type: "server_tool_use", name: "web_search", input: { query: "dome PVC" } },
        { type: "web_search_tool_result", content: [] },
      ],
      stop_reason: "end_turn",
      usage: USAGE,
    });

    const result = await researchSuppliers(CTX);

    expect(result.queries).toEqual(["dome PVC"]);
    expect(result.candidates).toEqual([]);
    // No findings prose → extraction is never paid for.
    expect(parseMock).not.toHaveBeenCalled();
  });
});

// The plan decides which model searches (fixed 2026-11-18). `plan.model_tier`
// was stored, editable and priced on /interne/plans from the day plans were
// built, and no search ever read it: all of them ran on ANTHROPIC_MODEL.
describe("the search model comes from the workspace's plan", () => {
  type SearchCall = { model: string; tools: Array<{ type: string }> };
  const firstCall = () => createMock.mock.calls[0]?.[0] as SearchCall;

  it("uses the platform's model when no plan applies", () => {
    expect(searchModelFor(null).id).toBe("test-research-model");
    expect(searchModelFor(undefined).id).toBe("test-research-model");
  });

  it("uses the registry's model for each tier", () => {
    expect(searchModelFor("cheap")).toBe(RESEARCH_MODELS.cheap);
    expect(searchModelFor("balanced")).toBe(RESEARCH_MODELS.balanced);
    expect(searchModelFor("best")).toBe(RESEARCH_MODELS.best);
  });

  it("sends the search to the plan's model, with the search tool that model takes", async () => {
    createMock.mockResolvedValueOnce(searchingPass("dome PVC"));
    parseMock.mockResolvedValue(ONE_CANDIDATE);

    await researchSuppliers({ ...CTX, modelTier: "best" });

    expect(firstCall().model).toBe(RESEARCH_MODELS.best.id);
    // Not the platform default's tool: sending the basic variant to a model
    // that filters results itself would pay for the unfiltered pages.
    expect(firstCall().tools[0]?.type).toBe(RESEARCH_MODELS.best.searchTool);
  });

  it("keeps the platform's model and tool for a request with no plan tier", async () => {
    createMock.mockResolvedValueOnce(searchingPass("dome PVC"));
    parseMock.mockResolvedValue(ONE_CANDIDATE);

    await researchSuppliers(CTX);

    expect(firstCall().model).toBe("test-research-model");
    expect(firstCall().tools[0]?.type).toBe("web_search_20250305");
  });

  it("leaves extraction on the extraction model whatever the plan says", async () => {
    createMock.mockResolvedValueOnce(searchingPass("dome PVC"));
    parseMock.mockResolvedValue(ONE_CANDIDATE);

    await researchSuppliers({ ...CTX, modelTier: "best" });

    expect((parseMock.mock.calls[0]?.[0] as { model: string }).model).toBe("test-extraction-model");
  });
});
