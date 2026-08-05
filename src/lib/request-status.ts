// Pure request state machine — client- and server-safe (no server imports).
// The impure side (DB writes + events) lives in src/server/requests.ts.

import type { RequestStatus } from "@/database/schema";

export const REQUEST_TRANSITIONS: Record<RequestStatus, readonly RequestStatus[]> = {
  draft: ["received", "cancelled"],
  received: ["analyzing", "cancelled"],
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
  { status: "analyzing", stepKey: "analysis", progressPct: 35 },
  { status: "searching", stepKey: "search", progressPct: 65 },
  { status: "validating", stepKey: "validation", progressPct: 85 },
  { status: "report_ready", stepKey: "report", progressPct: 100 },
] as const satisfies readonly {
  status: RequestStatus;
  stepKey: string;
  progressPct: number;
}[];

/** Index of a status within the pipeline (-1 for draft/closed/cancelled). */
export function pipelineIndex(status: RequestStatus): number {
  return PIPELINE_ORDER.findIndex((step) => step.status === status);
}

export function progressPct(status: RequestStatus): number {
  if (status === "closed") return 100;
  const step = PIPELINE_ORDER[pipelineIndex(status)];
  return step ? step.progressPct : 0;
}

/** True while the pipeline is moving on its own — the detail page polls in these
 *  states. "analyzing" is excluded: it only moves while extraction runs (criteria
 *  still empty) and then rests for review — callers poll analyzing+no-criteria. */
export function isInFlight(status: RequestStatus): boolean {
  return status === "received" || status === "searching" || status === "validating";
}
