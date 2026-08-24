// Workspace-role ranking (B1, 2026-08-23) — pure and client-safe, so UI
// affordances and server guards share one definition of "may this role act".
//
// Three live roles since the 2026-08-23 merge: owner runs the account AND the
// team; buyer works; viewer reads. "admin" remains schema-valid for a possible
// future tier but nothing grants it — it ranks like buyer so any legacy row
// keeps working-seat rights rather than silently gaining owner powers.

export type WorkspaceRole = "owner" | "admin" | "buyer" | "viewer";

const RANK: Record<WorkspaceRole, number> = {
  viewer: 0,
  buyer: 1,
  admin: 1,
  owner: 2,
};

/** Minimum roles a guard can ask for ("admin" is never a requirement). */
export type RequiredWorkspaceRole = "viewer" | "buyer" | "owner";

export function hasWorkspaceRole(
  role: string | null | undefined,
  min: RequiredWorkspaceRole,
): boolean {
  if (!role || !(role in RANK)) return false;
  return RANK[role as WorkspaceRole] >= RANK[min];
}
