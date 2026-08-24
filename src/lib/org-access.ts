// Workspace access control for the better-auth organization plugin (B3,
// 2026-08-23) — shared by the server plugin and the client plugin so both
// know the SAME roles: owner | buyer | viewer (+ legacy admin, powerless).
//
// Only the owner manages the organization (2026-08-23 merge). buyer/viewer
// carry no org-management permissions at all — their app-level rights come
// from src/lib/workspace-roles.ts, not from here.

import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements, ownerAc } from "better-auth/plugins/organization/access";

export const orgStatement = { ...defaultStatements } as const;

export const orgAc = createAccessControl(orgStatement);

export const orgRoles = {
  owner: orgAc.newRole({ ...ownerAc.statements }),
  buyer: orgAc.newRole({}),
  viewer: orgAc.newRole({}),
  // Legacy string kept schema-valid; grants nothing (ranks like buyer in app
  // guards, manages nothing here).
  admin: orgAc.newRole({}),
};
