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

/** The roles that ship with the product and carry code defaults. */
export type BuiltInRole = "user" | "owner" | "manager" | "accountant";

/** The two built-in STAFF roles — the ones the defaults below can grant.
 *  `owner` is not here: it always has everything and is never a row. */
export const BUILT_IN_STAFF_ROLES = ["manager", "accountant"] as const;

/**
 * Any staff role name (Phase R, 2026-08-29): the two built-ins, or a role the
 * owner created. The string half is what opens the set — `platform_role.name`,
 * `platform_permission.role` and `user.platform_role` are all TEXT, so a custom
 * role needs no migration to be storable, only this type to stop pretending
 * the set is closed.
 *
 * `(string & {})` rather than plain `string` so editors still autocomplete the
 * built-ins instead of collapsing the union to "any text".
 */
export type PlatformRole = BuiltInRole | (string & {});

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
} as const satisfies Record<string, readonly BuiltInRole[]>;

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
  /**
   * Read EVERY workspace's sourcing data — the ops view behind "Vue globale",
   * the cross-tenant request/supplier/stats reads, and the internal surfaces
   * that list other people's dossiers.
   *
   * Was a hardcoded role list (`canSeeAllRequests`: owner or manager) until
   * Phase R. A custom role could never have passed that test, so it would have
   * been granted internal features and then shown empty lists — the feature
   * would look built and be useless. Defaults reproduce the old list exactly,
   * so nothing changes for the built-ins.
   *
   * Accountant is deliberately NOT here (decided 2026-08-04): their domain is
   * finance, not buyers' sourcing dossiers.
   */
  "requests.all": ["owner", "manager"],
} as const satisfies Record<string, readonly BuiltInRole[]>;

export type PermissionKey = PlatformFeature | keyof typeof PLATFORM_CAPABILITIES;

export const PERMISSION_KEYS = [
  ...(Object.keys(PLATFORM_FEATURES) as PlatformFeature[]),
  ...(Object.keys(PLATFORM_CAPABILITIES) as (keyof typeof PLATFORM_CAPABILITIES)[]),
] as PermissionKey[];

/**
 * The default grant for a key when the table has no row.
 *
 * A CUSTOM role matches none of these lists, so it starts with nothing granted
 * — which is the rule Phase R asked for: a brand-new role inherits nobody's
 * access and the owner switches on exactly what it needs.
 */
export function defaultGrant(key: PermissionKey, role: PlatformRole): boolean {
  const grants: readonly string[] =
    key in PLATFORM_FEATURES
      ? PLATFORM_FEATURES[key as PlatformFeature]
      : PLATFORM_CAPABILITIES[key as keyof typeof PLATFORM_CAPABILITIES];
  return grants.includes(role);
}

/** Any role that is not a plain customer. Open-ended since Phase R: a custom
 *  role is staff too, so this cannot be a list of names. */
export function isEmployee(role: string | undefined): boolean {
  return Boolean(role) && role !== "user";
}

export function hasPlatformFeature(role: string | undefined, feature: PlatformFeature): boolean {
  return (PLATFORM_FEATURES[feature] as readonly string[]).includes(role ?? "user");
}

/**
 * Data visibility (decided 2026-08-04, made grantable by Phase R): buyers see
 * their own workspace only; whoever holds `requests.all` sees every buyer's
 * sourcing data plus their own. Defaults keep that at owner + manager, with
 * accountant excluded — their domain is finance, not sourcing dossiers.
 *
 * Takes the RESOLVED permission set, not a role name, because a custom role's
 * answer lives in the database and a role string cannot be asked. On the
 * client the set arrives on the session (`platformFeatures`); on the server,
 * call `effectiveHasPermission(session, "requests.all")` instead.
 */
export function canSeeAllRequests(features: readonly string[] | undefined): boolean {
  return features?.includes("requests.all") ?? false;
}
