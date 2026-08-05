// Pure request state machine — client- and server-safe (no server imports).
// The impure side (DB writes + events) lives in src/server/requests.ts.
//
// Since the pre-search AI analysis was removed (2026-08-05), the pipeline is
// received → searching → validating → report_ready. "analyzing" remains in
// the status enum ONLY for legacy rows (pre-removal dossiers paused for
// review) — it is never entered by new requests.

import type { RequestStatus } from "@/database/schema";

export const REQUEST_TRANSITIONS: Record<RequestStatus, readonly RequestStatus[]> = {
  draft: ["received", "cancelled"],
  received: ["searching", "cancelled"],
  // Legacy pause state: still allowed to move forward or be cancelled.
  analyzing: ["searching", "cancelled"],
  searching: ["validating", "cancelled"],
  validating: ["report_ready", "cancelled"],
  report_ready: ["closed"],
  closed: [],
  cancelled: [],
};

export function canTransition(from: RequestStatus, to: RequestStatus): boolean {
  return REQUEST_TRANSITIONS[from].includes(to);
}

/** Pipeline stages in order; stepKey matches the existing stepsFlux.* i18n keys. */
export const PIPELINE_ORDER = [
  { status: "received", stepKey: "received", progressPct: 10 },
  { status: "searching", stepKey: "search", progressPct: 45 },
  { status: "validating", stepKey: "validation", progressPct: 75 },
  { status: "report_ready", stepKey: "report", progressPct: 100 },
] as const satisfies readonly {
  status: RequestStatus;
  stepKey: string;
  progressPct: number;
}[];

/** Index of a status within the pipeline (-1 for draft/closed/cancelled).
 *  Legacy "analyzing" rows map to the first stage. */
export function pipelineIndex(status: RequestStatus): number {
  if (status === "analyzing") return 0;
  return PIPELINE_ORDER.findIndex((step) => step.status === status);
}

export function progressPct(status: RequestStatus): number {
  if (status === "closed") return 100;
  if (status === "analyzing") return 10;
  const step = PIPELINE_ORDER[pipelineIndex(status)];
  return step ? step.progressPct : 0;
}

/** True while the pipeline is moving on its own — the detail page polls in
 *  these states. Legacy "analyzing" rows rest until manually launched. */
export function isInFlight(status: RequestStatus): boolean {
  return status === "received" || status === "searching" || status === "validating";
}
