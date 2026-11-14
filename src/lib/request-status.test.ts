// The request state machine — specifically the one edge added on 2026-09-07,
// because it is the only one that moves BACKWARDS and a later reader will
// reasonably wonder whether that was a mistake.

import { describe, expect, it } from "vitest";
import fr from "@/i18n/locales/fr.json";
import en from "@/i18n/locales/en.json";
import { REQUEST_STATUSES, type RequestStatus } from "@/database/schema";
import {
  canTransition,
  criteriaEditable,
  forksToPack,
  IN_FLIGHT_STATUSES,
  isInFlight,
  isTerminal,
  ownerSeesMatches,
  PACK_PIPELINE_ORDER,
  PIPELINE_ORDER,
  pipelineFor,
  pipelineIndex,
  progressPct,
  REQUEST_TRANSITIONS,
  requestFlow,
  STEP_KEYS,
} from "@/lib/request-status";

describe("re-running a failed research reopens the search", () => {
  it("lets a finished report go back to searching", () => {
    // rerunResearchFn needs this: the research worker hands back to the
    // pipeline queue, and the pipeline does nothing to a report_ready
    // request — the suppliers would land in the store and never reach the
    // buyer's Top-N.
    expect(canTransition("report_ready", "searching")).toBe(true);
  });

  it("does not make report_ready a general re-entry point", () => {
    // Two ways back, one per flow (V04 added `soliciting`): the failed-research
    // re-run, and the pack flow's expired offer. Nothing else.
    expect(REQUEST_TRANSITIONS.report_ready).toEqual(["closed", "searching", "soliciting"]);
    for (const to of ["draft", "received", "validating", "cancelled"] as const) {
      expect(canTransition("report_ready", to)).toBe(false);
    }
  });

  it("leaves the terminal states terminal", () => {
    // A closed or cancelled request is done. Reopening one is a new request,
    // not a re-run — and the re-run fn refuses both.
    expect(REQUEST_TRANSITIONS.closed).toEqual([]);
    expect(REQUEST_TRANSITIONS.cancelled).toEqual([]);
    expect(canTransition("closed", "searching")).toBe(false);
    expect(canTransition("cancelled", "searching")).toBe(false);
  });

  it("keeps the forward pipeline exactly as it was", () => {
    expect(canTransition("received", "searching")).toBe(true);
    expect(canTransition("searching", "validating")).toBe(true);
    expect(canTransition("validating", "report_ready")).toBe(true);
    expect(canTransition("report_ready", "closed")).toBe(true);
    // No skipping: the sweep and the worker both rely on this.
    expect(canTransition("received", "report_ready")).toBe(false);
    expect(canTransition("searching", "report_ready")).toBe(false);
  });
});

// ── Phase V · V04: the pack flow ─────────────────────────────────────────────

/** Every legal edge, written out. Anything not in this table must be refused —
 *  the test below walks all 144 pairs, so an edge added to the machine without
 *  being added here fails, and so does one removed. */
const LEGAL: Record<RequestStatus, RequestStatus[]> = {
  draft: ["received", "cancelled"],
  received: ["searching", "cancelled"],
  analyzing: ["searching", "cancelled"],
  searching: ["validating", "cancelled"],
  validating: ["report_ready", "shortlisted", "cancelled"],
  shortlisted: ["soliciting", "cancelled"],
  soliciting: ["pack_review", "cancelled"],
  pack_review: ["report_ready", "soliciting", "unfulfilled", "cancelled"],
  report_ready: ["closed", "searching", "soliciting"],
  unfulfilled: [],
  closed: [],
  cancelled: [],
};

describe("the whole machine", () => {
  it("allows exactly the edges written down, and refuses every other pair", () => {
    for (const from of REQUEST_STATUSES) {
      for (const to of REQUEST_STATUSES) {
        expect(canTransition(from, to), `${from} → ${to}`).toBe(LEGAL[from].includes(to));
      }
    }
  });

  it("walks the pack flow end to end", () => {
    const path: RequestStatus[] = [
      "received",
      "searching",
      "validating",
      "shortlisted",
      "soliciting",
      "pack_review",
      "report_ready",
      "closed",
    ];
    for (let i = 1; i < path.length; i++) {
      expect(canTransition(path[i - 1]!, path[i]!), `${path[i - 1]} → ${path[i]}`).toBe(true);
    }
  });

  it("does not let the pack flow skip a stage", () => {
    expect(canTransition("validating", "soliciting")).toBe(false);
    expect(canTransition("shortlisted", "pack_review")).toBe(false);
    // Nothing reaches the buyer without the review — release is staff's act,
    // or the system's under the automatic mode, but never a skipped state.
    expect(canTransition("shortlisted", "report_ready")).toBe(false);
    expect(canTransition("soliciting", "report_ready")).toBe(false);
  });

  it("gives staff their four powers at the review, and only there", () => {
    // approve / correct both release; relaunch; refuse.
    expect(canTransition("pack_review", "report_ready")).toBe(true);
    expect(canTransition("pack_review", "soliciting")).toBe(true);
    expect(canTransition("pack_review", "unfulfilled")).toBe(true);
    for (const from of REQUEST_STATUSES.filter((status) => status !== "pack_review")) {
      expect(canTransition(from, "unfulfilled"), `${from} → unfulfilled`).toBe(false);
    }
  });

  it("lets the buyer withdraw at any point before the end", () => {
    for (const from of ["shortlisted", "soliciting", "pack_review"] as const) {
      expect(canTransition(from, "cancelled")).toBe(true);
    }
  });

  it("has three endings, and none of them leads anywhere", () => {
    for (const status of REQUEST_STATUSES) {
      const terminal = status === "closed" || status === "cancelled" || status === "unfulfilled";
      expect(isTerminal(status), status).toBe(terminal);
      if (terminal) expect(REQUEST_TRANSITIONS[status]).toEqual([]);
    }
  });
});

describe("which flow a request is on", () => {
  it("is the pack flow in any state only that flow has", () => {
    for (const status of ["shortlisted", "soliciting", "pack_review", "unfulfilled"] as const) {
      expect(requestFlow(status, [])).toBe("pack");
    }
  });

  // Both flows share these three states, so the status alone cannot say —
  // having passed through `shortlisted` is what does.
  it("is read from the past for the states both flows share", () => {
    const packPast = ["status.received", "status.shortlisted", "status.soliciting"];
    for (const status of ["report_ready", "closed", "cancelled"] as const) {
      expect(requestFlow(status, packPast), status).toBe("pack");
      expect(requestFlow(status, ["status.received", "status.validating"]), status).toBe("report");
    }
  });

  // The fork happens when `validating` finishes. Drawing seven stages for a
  // request that then takes four would be a lie told in advance.
  it("does not predict: a request that has not forked is on the report flow", () => {
    for (const status of ["draft", "received", "searching", "validating"] as const) {
      expect(requestFlow(status, ["status.received"]), status).toBe("report");
    }
  });

  it("keeps the shortlist from the workspace that owns a pack-flow request", () => {
    expect(ownerSeesMatches("report")).toBe(true);
    expect(ownerSeesMatches("pack")).toBe(false);
  });
});

describe("the stages a dossier draws", () => {
  it("leaves the report flow exactly as it was", () => {
    expect(PIPELINE_ORDER.map((step) => step.stepKey)).toEqual([
      "received",
      "search",
      "validation",
      "report",
    ]);
    expect(progressPct("received")).toBe(10);
    expect(progressPct("searching")).toBe(45);
    expect(progressPct("validating")).toBe(75);
    expect(progressPct("report_ready")).toBe(100);
  });

  it.each([
    ["report", PIPELINE_ORDER],
    ["pack", PACK_PIPELINE_ORDER],
  ] as const)("advances steadily to 100 on the %s flow", (flow, steps) => {
    expect(pipelineFor(flow)).toBe(steps);
    const pcts = steps.map((step) => step.progressPct);
    expect(pcts).toEqual([...pcts].sort((a, b) => a - b));
    expect(new Set(pcts).size).toBe(pcts.length);
    expect(steps.at(-1)).toMatchObject({ status: "report_ready", progressPct: 100 });
    steps.forEach((step, index) => {
      expect(pipelineIndex(step.status, flow)).toBe(index);
      expect(progressPct(step.status, flow)).toBe(step.progressPct);
    });
  });

  it("places a pack-only state nowhere on the report flow", () => {
    expect(pipelineIndex("shortlisted", "report")).toBe(-1);
    expect(progressPct("soliciting", "report")).toBe(0);
  });

  // It stopped at the review; the dossier marks that stage, not the end.
  it("shows a refused request stopped at the review stage", () => {
    expect(pipelineIndex("unfulfilled", "pack")).toBe(pipelineIndex("pack_review", "pack"));
    expect(progressPct("unfulfilled", "pack")).toBe(progressPct("pack_review", "pack"));
  });
});

describe("what moves on its own", () => {
  it("is the three pipeline states and nothing else", () => {
    expect([...IN_FLIGHT_STATUSES]).toEqual(["received", "searching", "validating"]);
    for (const status of REQUEST_STATUSES) {
      expect(isInFlight(status), status).toBe(
        status === "received" || status === "searching" || status === "validating",
      );
    }
  });

  // The worker's stranded sweep re-adopts whatever is in this list after two
  // minutes. `shortlisted` and `pack_review` wait on a person, `soliciting` on
  // a clock — re-adopting them would re-run the pipeline over a live round.
  it("never includes a state that waits on a person or a clock", () => {
    for (const status of ["shortlisted", "soliciting", "pack_review"] as const) {
      expect(isInFlight(status), status).toBe(false);
    }
  });
});

describe("when the criteria can still change", () => {
  it("is before the search has answered, and never once suppliers are asked", () => {
    const editable = REQUEST_STATUSES.filter(criteriaEditable);
    expect(editable).toEqual(["draft", "received", "analyzing", "searching", "validating"]);
  });
});

describe("labels", () => {
  it.each([
    ["fr", fr],
    ["en", en],
  ] as const)("every state and stage has one in %s", (_locale, locale) => {
    const statuses = locale.statuses as Record<string, unknown>;
    const events = locale.events as Record<string, unknown>;
    const stepsFlux = locale.stepsFlux as Record<string, unknown>;
    const stepsDemande = locale.stepsDemande as Record<string, unknown>;
    for (const status of REQUEST_STATUSES) {
      expect(statuses[status], `statuses.${status}`).toBeTypeOf("string");
      // `transitionRequest` records `status.<to>` on the timeline for every
      // state something can move INTO — `draft` is the only one nothing does.
      if (status !== "draft") {
        expect(events[`status_${status}`], `events.status_${status}`).toBeTypeOf("string");
      }
    }
    for (const key of STEP_KEYS) {
      expect(stepsFlux[key], `stepsFlux.${key}`).toBeTypeOf("string");
      expect(stepsDemande[key], `stepsDemande.${key}`).toBeTypeOf("object");
    }
  });
});

// ── Phase V · V05: the fork ──────────────────────────────────────────────────

describe("which requests take the pack flow", () => {
  it("needs BOTH a plan with quotes and the flow switched on", () => {
    expect(forksToPack(true, "on")).toBe(true);
    expect(forksToPack(true, "off")).toBe(false);
    // A plan without quotes ends at the report whatever the switch says
    // (owner, 2026-11-14: the plan decides who enters the V6 flow).
    expect(forksToPack(false, "on")).toBe(false);
    expect(forksToPack(false, "off")).toBe(false);
  });
});
