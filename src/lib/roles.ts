// One dashboard for everyone — features are added/removed by role
// (decided 2026-08-04, doc/BACKLOG.md).
//
// Since 2026-08-28 (owner request) staff access is DATA: the
// `platform_permission` table says what MANAGER and ACCOUNTANT may do,
// editable live from /interne/utilisateurs → Rôles & accès. The maps below
// are the DEFAULTS (used to seed the table and as the fallback for a key
// with no row). The platform OWNER always has everything — hardcoded, never
// a row, so the permission system cannot lock out its own owner. Role
// granting itself is owner-only forever (never in the table). Server-side
// resolution lives in src/server/permissions.ts; the session ships the
// resolved set for client gating.

export type PlatformRole = "user" | "owner" | "manager" | "accountant";

export const PLATFORM_FEATURES = {
  facilitation: ["owner", "manager"],
  verification: ["owner", "manager"],
  finance: ["owner", "accountant"],
  // Spend analytics is an employee surface — hidden from buyers (2026-08-05).
  analytics: ["owner", "manager", "accountant"],
  // Plans & subscriptions (owner decision 2026-08-27: "owner combines all
  // rights") — money & rules are OWNER territory; managers operate.
  plans: ["owner"],
  // Platform user management: every account, its workspace, plan and usage.
  users: ["owner", "manager"],
  // The audit journal — every lifecycle/admin action, per org, per user.
  logging: ["owner", "manager"],
  // Customer accounts by type — individual vs organisation (2026-08-26).
  clients: ["owner", "manager"],
  // Data-source catalogue: enable/disable, store browser, refresh, bans (C1).
  sources: ["owner", "manager"],
  // Phase P: soliciting suppliers for a quote, recording what comes back, and
  // running the dossiers that acceptance opens. Operations work — manager
  // territory alongside the owner.
  deals: ["owner", "manager"],
  // The contract centre — reading and drafting. SIGNING is separate below.
  contracts: ["owner", "manager"],
} as const satisfies Record<string, readonly PlatformRole[]>;

export type PlatformFeature = keyof typeof PLATFORM_FEATURES;

/** Fine-grained capabilities inside a feature — same permission machinery,
 *  finer key. Defaults mirror the ②j owner/manager split. */
export const PLATFORM_CAPABILITIES = {
  "sources.toggle": [],
  "sources.wipe": [],
  "logging.purge": [],
  // Sending a contract to its parties is operations.
  "contracts.send": [],
  /** Signing ON OSI'S BEHALF. Owner-only by default (owner 2026-08-29: the
   *  owner assigns it per role from Rôles & accès) — a manager putting the
   *  company's name to a commercial commitment is a real delegation, so it
   *  starts off and is granted deliberately, never inherited. */
  "contracts.sign": [],
  /** Voiding a contract destroys the paperwork behind a deal — owner-only. */
  "contracts.void": [],
} as const satisfies Record<string, readonly PlatformRole[]>;

export type PermissionKey = PlatformFeature | keyof typeof PLATFORM_CAPABILITIES;

export const PERMISSION_KEYS = [
  ...(Object.keys(PLATFORM_FEATURES) as PlatformFeature[]),
  ...(Object.keys(PLATFORM_CAPABILITIES) as (keyof typeof PLATFORM_CAPABILITIES)[]),
] as PermissionKey[];

/** The default grant for a key when the table has no row (fresh feature). */
export function defaultGrant(key: PermissionKey, role: PlatformRole): boolean {
  const grants: readonly PlatformRole[] =
    key in PLATFORM_FEATURES
      ? PLATFORM_FEATURES[key as PlatformFeature]
      : PLATFORM_CAPABILITIES[key as keyof typeof PLATFORM_CAPABILITIES];
  return grants.includes(role);
}

export function isEmployee(role: string | undefined): boolean {
  return role === "owner" || role === "manager" || role === "accountant";
}

export function hasPlatformFeature(role: string | undefined, feature: PlatformFeature): boolean {
  return (PLATFORM_FEATURES[feature] as readonly string[]).includes(role ?? "user");
}

/** Data visibility (decided 2026-08-04): buyers see their own workspace only;
 *  owner/manager see ALL buyers' sourcing data (ops) plus their own;
 *  accountant is forbidden from buyers' sourcing dossiers — their domain is
 *  finance (transactions, E8) plus their own data. */
export function canSeeAllRequests(role: string | undefined): boolean {
  return role === "owner" || role === "manager";
}
