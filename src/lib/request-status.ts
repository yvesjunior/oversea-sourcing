// Pure request state machine — client- and server-safe (no server imports).
// The impure side (DB writes + events) lives in src/server/requests.ts.
//
// Since the pre-search AI analysis was removed (2026-08-05), the pipeline is
// received → searching → validating → report_ready. "analyzing" remains in
// the status enum ONLY for legacy rows (pre-removal dossiers paused for
// review) — it is never entered by new requests.
//
// ── Two flows since Phase V (V04, 2026-11-14) ───────────────────────────────
//
// The validated V6 parcours adds a stretch after `validating`:
//
//   REPORT flow   received → searching → validating → report_ready
//   PACK flow     received → searching → validating → shortlisted → soliciting
//                 → pack_review → report_ready
//
// Which one a request takes is decided ONCE, when `validating` finishes, by
// the workspace's plan (`plan.quotes_enabled` — owner, 2026-11-14): without
// quotes it ends at the Top-N report as it always has; with them it goes on
// to shortlist, RFQ and Decision Pack. Nothing in this file reads the plan —
// the fork is the worker's (V05). What this file knows is which flow a
// request IS on, from where it has been (`requestFlow`).

import type { RequestStatus } from "@/database/schema";

export const REQUEST_TRANSITIONS: Record<RequestStatus, readonly RequestStatus[]> = {
  draft: ["received", "cancelled"],
  received: ["searching", "cancelled"],
  // Legacy pause state: still allowed to move forward or be cancelled.
  analyzing: ["searching", "cancelled"],
  searching: ["validating", "cancelled"],
  // The fork. `report_ready` is the report flow, `shortlisted` the pack flow.
  validating: ["report_ready", "shortlisted", "cancelled"],
  shortlisted: ["soliciting", "cancelled"],
  soliciting: ["pack_review", "cancelled"],
  // Staff's four powers at this moment (owner, 2026-10-25): approve or correct
  // both release the pack (→ report_ready), relaunch reopens a round
  // (→ soliciting), refuse ends it (→ unfulfilled).
  pack_review: ["report_ready", "soliciting", "unfulfilled", "cancelled"],
  // Two ways back, one per flow, and each fn that takes one checks it is on
  // the right flow — the machine cannot, since both flows end on this state:
  //
  //  • → `searching` is the RE-RUN of a failed research pass (rerunResearchFn,
  //    2026-09-07): the report exists but was built on a collection that never
  //    happened, so reopening the search is the honest move. Not a general
  //    "reopen" — the fn refuses unless the request's latest research_run is
  //    `failed`, and that state only exists because a pass genuinely produced
  //    nothing.
  //  • → `soliciting` is the pack flow's return: an offer expired while the
  //    buyer was deciding and they ask that supplier again (V13).
  report_ready: ["closed", "searching", "soliciting"],
  unfulfilled: [],
  closed: [],
  cancelled: [],
};

export function canTransition(from: RequestStatus, to: RequestStatus): boolean {
  return REQUEST_TRANSITIONS[from].includes(to);
}

/**
 * May the criteria still be changed?
 *
 * Only before the search has produced its answer. Written as an ALLOW list on
 * purpose: the rule used to be "not finished and not cancelled", which would
 * have quietly included every state added since — and criteria edited while
 * an RFQ round is open change the specification under suppliers who are
 * already quoting against it.
 */
export function criteriaEditable(status: RequestStatus): boolean {
  return (
    status === "draft" ||
    status === "received" ||
    status === "analyzing" ||
    status === "searching" ||
    status === "validating"
  );
}

/** States with no way out. `unfulfilled` is the pack flow's own ending. */
export const TERMINAL_STATUSES: readonly RequestStatus[] = ["closed", "cancelled", "unfulfilled"];

export function isTerminal(status: RequestStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

// ── flows ───────────────────────────────────────────────────────────────────

export type RequestFlow = "report" | "pack";

/**
 * The fork, decided once when `validating` finishes.
 *
 * Both must hold: the workspace's plan includes quotes (owner, 2026-11-14 —
 * the plan decides who enters the V6 flow), AND the platform has the pack
 * flow switched on. The second condition is temporary scaffolding: it lets
 * the flow be built and exercised task by task without stranding real
 * requests in a state the product cannot yet move them out of.
 */
export function forksToPack(planHasQuotes: boolean, packFlowSetting: "off" | "on"): boolean {
  return planHasQuotes && packFlowSetting === "on";
}

/** States only the pack flow can be in. */
const PACK_ONLY_STATUSES: readonly RequestStatus[] = [
  "shortlisted",
  "soliciting",
  "pack_review",
  "unfulfilled",
];

/**
 * Which flow a request is on, from where it has BEEN.
 *
 * Derived, not stored: a request is on the pack flow if it is in a pack-only
 * state now, or ever entered `shortlisted` — the one door into that flow, so
 * its `status.shortlisted` event is the proof. That second half is what
 * answers for `report_ready`, `closed` and `cancelled`, which both flows share.
 *
 * It deliberately does NOT predict. A request still in `validating` is on the
 * report flow as far as this function knows, even on a plan that will send it
 * to the shortlist a moment later: the fork has not happened, and a screen
 * that drew seven steps for a request that then took four would have lied.
 */
export function requestFlow(status: RequestStatus, eventTypes: readonly string[]): RequestFlow {
  if (PACK_ONLY_STATUSES.includes(status)) return "pack";
  return eventTypes.includes("status.shortlisted") ? "pack" : "report";
}

/**
 * May the workspace that owns the request read its `match` rows?
 *
 * On the report flow the ranked suppliers ARE the answer. On the pack flow
 * they are OSI's internal shortlist, and the buyer sees no supplier before
 * the Decision Pack (owner, 2026-11-14) — then sees the pack, never the
 * shortlist behind it. So the answer is by flow, not by state: there is no
 * moment on the pack flow at which the shortlist becomes the buyer's.
 */
export function ownerSeesMatches(flow: RequestFlow): boolean {
  return flow === "report";
}

// ── the stages a dossier shows ──────────────────────────────────────────────

type PipelineStep = { status: RequestStatus; stepKey: string; progressPct: number };

/** Report-flow stages in order; stepKey matches the stepsFlux.* i18n keys. */
export const PIPELINE_ORDER = [
  { status: "received", stepKey: "received", progressPct: 10 },
  { status: "searching", stepKey: "search", progressPct: 45 },
  { status: "validating", stepKey: "validation", progressPct: 75 },
  { status: "report_ready", stepKey: "report", progressPct: 100 },
] as const satisfies readonly PipelineStep[];

/** Pack-flow stages. The first three are the same work as the report flow —
 *  they simply weigh less in a longer journey. */
export const PACK_PIPELINE_ORDER = [
  { status: "received", stepKey: "received", progressPct: 8 },
  { status: "searching", stepKey: "search", progressPct: 25 },
  { status: "validating", stepKey: "validation", progressPct: 40 },
  { status: "shortlisted", stepKey: "shortlist", progressPct: 52 },
  { status: "soliciting", stepKey: "rfq", progressPct: 68 },
  { status: "pack_review", stepKey: "review", progressPct: 85 },
  { status: "report_ready", stepKey: "pack", progressPct: 100 },
] as const satisfies readonly PipelineStep[];

/** Every stage either flow can draw — the key the labels and icons hang on. */
export type StepKey =
  (typeof PIPELINE_ORDER)[number]["stepKey"] | (typeof PACK_PIPELINE_ORDER)[number]["stepKey"];

export const STEP_KEYS: readonly StepKey[] = [
  ...new Set<StepKey>([...PIPELINE_ORDER, ...PACK_PIPELINE_ORDER].map((step) => step.stepKey)),
];

export function pipelineFor(flow: RequestFlow): readonly (PipelineStep & { stepKey: StepKey })[] {
  return flow === "pack" ? PACK_PIPELINE_ORDER : PIPELINE_ORDER;
}

/**
 * Index of a status within its flow's pipeline (-1 for draft / closed /
 * cancelled). Legacy "analyzing" rows map to the first stage; `unfulfilled`
 * maps to the review stage — that is where the request stopped.
 */
export function pipelineIndex(status: RequestStatus, flow: RequestFlow = "report"): number {
  if (status === "analyzing") return 0;
  const at = status === "unfulfilled" ? "pack_review" : status;
  return pipelineFor(flow).findIndex((step) => step.status === at);
}

export function progressPct(status: RequestStatus, flow: RequestFlow = "report"): number {
  if (status === "closed") return 100;
  if (status === "analyzing") return 10;
  const step = pipelineFor(flow)[pipelineIndex(status, flow)];
  return step ? step.progressPct : 0;
}

/**
 * The states in which the pipeline is moving ON ITS OWN.
 *
 * One list for two readers that must never disagree: the dossier page polls
 * in these states, and the worker's stranded sweep re-adopts a request that
 * has sat in one for too long. The pack flow's `shortlisted`, `soliciting`
 * and `pack_review` are deliberately absent — the first and last wait on a
 * person and the middle one on a clock. A sweep that re-adopted them would
 * re-run the pipeline over a live RFQ round every two minutes.
 */
export const IN_FLIGHT_STATUSES = [
  "received",
  "searching",
  "validating",
] as const satisfies readonly RequestStatus[];

/** True while the pipeline is moving on its own — the detail page polls in
 *  these states. Legacy "analyzing" rows rest until manually launched. */
export function isInFlight(status: RequestStatus): boolean {
  return (IN_FLIGHT_STATUSES as readonly RequestStatus[]).includes(status);
}
