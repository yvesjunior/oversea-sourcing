// The request state machine — specifically the one edge added on 2026-09-07,
// because it is the only one that moves BACKWARDS and a later reader will
// reasonably wonder whether that was a mistake.

import { describe, expect, it } from "vitest";
import { canTransition, REQUEST_TRANSITIONS } from "@/lib/request-status";

describe("re-running a failed research reopens the search", () => {
  it("lets a finished report go back to searching", () => {
    // rerunResearchFn needs this: the research worker hands back to the
    // pipeline queue, and the pipeline does nothing to a report_ready
    // request — the suppliers would land in the store and never reach the
    // buyer's Top-N.
    expect(canTransition("report_ready", "searching")).toBe(true);
  });

  it("does not make report_ready a general re-entry point", () => {
    expect(REQUEST_TRANSITIONS.report_ready).toEqual(["closed", "searching"]);
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
