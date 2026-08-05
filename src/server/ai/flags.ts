// AI feature flags (no SDK imports — safe to load anywhere server-side).
// Note: the pre-search AI analysis was removed entirely (2026-08-05) — the
// hero prompt's info helper + synchronous intake parsing replaced it. AI is
// reserved for supplier research (E4) and the still-gated chat below.

/** AI_CHAT=true enables the per-request assistant chat. Default OFF — the
 *  hero request prompt is the only AI-facing input; the chat UI is hidden
 *  and the server refuses new messages. */
export function chatEnabled(): boolean {
  return process.env["AI_CHAT"] === "true";
}
