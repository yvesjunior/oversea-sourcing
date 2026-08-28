// Staff permission resolution (owner request 2026-08-28) — what a MANAGER or
// ACCOUNTANT may do is data (`platform_permission`), owner-edited from
// /interne/utilisateurs → Rôles & accès. The OWNER always has everything and
// never touches the table; a plain `user` has nothing. A key with no row
// falls back to the code defaults in src/lib/roles.ts.
//
// Reads are cached in-process for a short TTL — every server fn re-checks
// per call, and the cache keeps that at ~zero cost; the update fn busts it,
// so an owner's toggle bites on the next request in this process.

import { db } from "@/database";
import * as schema from "@/database/schema";
import { defaultGrant, PERMISSION_KEYS, type PermissionKey } from "@/lib/roles";

const CACHE_TTL_MS = 30_000;

let cache: { at: number; rows: Map<string, boolean> } | null = null;

function key(feature: string, role: string): string {
  return `${feature}|${role}`;
}

async function loadRows(): Promise<Map<string, boolean>> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.rows;
  const rows = new Map<string, boolean>();
  for (const row of await db.select().from(schema.platformPermission)) {
    rows.set(key(row.feature, row.role), row.enabled);
  }
  cache = { at: Date.now(), rows };
  return rows;
}

export function bustPermissionsCache(): void {
  cache = null;
}

/** The granted permission keys for an EFFECTIVE platform role. */
export async function grantedFeatures(role: string): Promise<PermissionKey[]> {
  if (role === "owner") return [...PERMISSION_KEYS];
  if (role !== "manager" && role !== "accountant") return [];
  const rows = await loadRows();
  return PERMISSION_KEYS.filter((k) => rows.get(key(k, role)) ?? defaultGrant(k, role));
}

/** One check, for server fns: effective role → table (fallback: defaults). */
export async function roleHasPermission(role: string, permission: PermissionKey): Promise<boolean> {
  if (role === "owner") return true;
  if (role !== "manager" && role !== "accountant") return false;
  const rows = await loadRows();
  return rows.get(key(permission, role)) ?? defaultGrant(permission, role);
}
