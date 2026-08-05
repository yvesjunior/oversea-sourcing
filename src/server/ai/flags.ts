// AI feature flags (no SDK imports — safe to load anywhere server-side).

/** AI_PROMPT_ANALYSIS=true enables Claude criteria extraction with the review
 *  pause before the search launches. Default OFF — tokens are reserved for
 *  supplier research (E4): criteria come from the free heuristic and the
 *  request goes STRAIGHT to supplier search (no pause). */
export function promptAnalysisEnabled(): boolean {
  return process.env["AI_PROMPT_ANALYSIS"] === "true";
}

/** AI_CHAT=true enables the per-request assistant chat. Default OFF — the
 *  hero request prompt is the only AI-facing input; the chat UI is hidden
 *  (existing transcripts stay readable) and the server refuses new messages. */
export function chatEnabled(): boolean {
  return process.env["AI_CHAT"] === "true";
}
