// Model registry for the AI gateway (doc/INFRA.md §4: "model tiering in the
// gateway — cheap model for extraction, strong model for research/reports").
//
// One place that knows, per model: which web-search tool it can use, what it
// costs, and what we measured. Without this the tool variant was a regex guess
// against the model name, and cost was folklore.
//
// ANTHROPIC_MODEL accepts either a tier name (cheap | balanced | best) or a raw
// model id, so switching is an env change and a restart — no code edit.

export const RESEARCH_TIERS = ["cheap", "balanced", "best"] as const;
export type ResearchTier = (typeof RESEARCH_TIERS)[number];

export type ModelSpec = {
  id: string;
  /** Dynamic filtering (`_20260209`) needs Opus 4.6+ / Sonnet 4.6+. Older and
   *  smaller models take the basic tool, which returns unfiltered results —
   *  more input tokens, and more directories/shops to weed out. */
  searchTool: "web_search_20260209" | "web_search_20250305";
  /** USD per million tokens, for the cost estimate in the logs. */
  price: { input: number; output: number };
  /** What we actually measured, so the next person doesn't re-run the tests. */
  note: string;
};

/** Priced per search by the API, independent of model: $10 / 1000. */
export const USD_PER_SEARCH = 0.01;

export const RESEARCH_MODELS: Record<ResearchTier, ModelSpec> = {
  cheap: {
    id: "claude-haiku-4-5",
    searchTool: "web_search_20250305",
    price: { input: 1, output: 5 },
    note: "~$0.06/request at 3 searches. Half the recall of sonnet on the same need, and it let a directory and a shop through — no dynamic filtering.",
  },
  balanced: {
    id: "claude-sonnet-5",
    searchTool: "web_search_20260209",
    price: { input: 2, output: 10 },
    note: "~$0.21/request at 6 searches — no cheaper than opus in practice (2.5x the output tokens) and slower. Intro pricing ends 2026-08-31.",
  },
  best: {
    id: "claude-opus-5",
    searchTool: "web_search_20260209",
    price: { input: 5, output: 25 },
    note: "~$0.20/request at 6 searches, ~$0.11 at 3. Cleanest results of the three; fastest of the three.",
  },
};

/** Default when ANTHROPIC_MODEL is unset. */
const DEFAULT_TIER: ResearchTier = "cheap";

function isTier(value: string): value is ResearchTier {
  return (RESEARCH_TIERS as readonly string[]).includes(value);
}

/**
 * Resolve ANTHROPIC_MODEL to a spec. Accepts a tier name, a registered model
 * id, or any other id — an unregistered id still works (so a model released
 * after this file was written is usable immediately), it just runs with the
 * conservative search tool and no cost estimate.
 */
export function resolveResearchModel(raw: string | undefined): ModelSpec {
  const value = raw?.trim();
  if (!value) return RESEARCH_MODELS[DEFAULT_TIER];
  if (isTier(value)) return RESEARCH_MODELS[value];

  const registered = Object.values(RESEARCH_MODELS).find((spec) => spec.id === value);
  if (registered) return registered;

  return {
    id: value,
    // Unknown model: assume it cannot do dynamic filtering. Wrong-but-working
    // beats a 400 on an unsupported tool type.
    searchTool: "web_search_20250305",
    price: { input: 0, output: 0 },
    note: "not in the registry — cost estimate unavailable, basic search tool assumed",
  };
}

/** Rough USD for one research pass, for the log line. Zero price = unknown. */
export function estimateCost(
  spec: ModelSpec,
  usage: { input: number; output: number; searches: number },
): number | null {
  if (spec.price.input === 0 && spec.price.output === 0) return null;
  return (
    (usage.input * spec.price.input) / 1_000_000 +
    (usage.output * spec.price.output) / 1_000_000 +
    usage.searches * USD_PER_SEARCH
  );
}
