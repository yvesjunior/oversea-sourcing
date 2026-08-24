// The one definition of "may this workspace role act" (B1) — shared by server
// guards and UI affordances, so it gets its own tests.

import { describe, expect, it } from "vitest";
import { hasWorkspaceRole } from "@/lib/workspace-roles";

describe("hasWorkspaceRole", () => {
  it("owner clears every bar", () => {
    expect(hasWorkspaceRole("owner", "viewer")).toBe(true);
    expect(hasWorkspaceRole("owner", "buyer")).toBe(true);
    expect(hasWorkspaceRole("owner", "owner")).toBe(true);
  });

  it("buyer works but does not own", () => {
    expect(hasWorkspaceRole("buyer", "viewer")).toBe(true);
    expect(hasWorkspaceRole("buyer", "buyer")).toBe(true);
    expect(hasWorkspaceRole("buyer", "owner")).toBe(false);
  });

  it("viewer only reads", () => {
    expect(hasWorkspaceRole("viewer", "viewer")).toBe(true);
    expect(hasWorkspaceRole("viewer", "buyer")).toBe(false);
    expect(hasWorkspaceRole("viewer", "owner")).toBe(false);
  });

  it("legacy admin ranks like buyer, never like owner (2026-08-23 merge)", () => {
    expect(hasWorkspaceRole("admin", "buyer")).toBe(true);
    expect(hasWorkspaceRole("admin", "owner")).toBe(false);
  });

  it("unknown or missing roles clear no bar", () => {
    expect(hasWorkspaceRole("superuser", "viewer")).toBe(false);
    expect(hasWorkspaceRole(null, "viewer")).toBe(false);
    expect(hasWorkspaceRole(undefined, "buyer")).toBe(false);
  });
});
