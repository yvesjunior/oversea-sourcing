// One dashboard for everyone — features are added/removed by role
// (decided 2026-08-04, doc/BACKLOG.md). This file is the single source of
// truth for which platform role unlocks which employee feature.

export type PlatformRole = "user" | "owner" | "manager" | "accountant";

export const PLATFORM_FEATURES = {
  facilitation: ["owner", "manager"],
  verification: ["owner", "manager"],
  imports: ["owner", "manager"],
  finance: ["owner", "accountant"],
} as const satisfies Record<string, readonly PlatformRole[]>;

export type PlatformFeature = keyof typeof PLATFORM_FEATURES;

export function isEmployee(role: string | undefined): boolean {
  return role === "owner" || role === "manager" || role === "accountant";
}

export function hasPlatformFeature(role: string | undefined, feature: PlatformFeature): boolean {
  return (PLATFORM_FEATURES[feature] as readonly string[]).includes(role ?? "user");
}
