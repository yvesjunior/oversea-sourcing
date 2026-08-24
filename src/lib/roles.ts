// One dashboard for everyone — features are added/removed by role
// (decided 2026-08-04, doc/BACKLOG.md). This file is the single source of
// truth for which platform role unlocks which employee feature.

export type PlatformRole = "user" | "owner" | "manager" | "accountant";

export const PLATFORM_FEATURES = {
  facilitation: ["owner", "manager"],
  verification: ["owner", "manager"],
  imports: ["owner", "manager"],
  finance: ["owner", "accountant"],
  // Spend analytics is an employee surface — hidden from buyers (2026-08-05).
  analytics: ["owner", "manager", "accountant"],
  // Plans & subscriptions: limits are edited here, so it is ops, not finance.
  plans: ["owner", "manager"],
  // Platform user management: every account, its workspace, plan and usage.
  users: ["owner", "manager"],
} as const satisfies Record<string, readonly PlatformRole[]>;

export type PlatformFeature = keyof typeof PLATFORM_FEATURES;

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
