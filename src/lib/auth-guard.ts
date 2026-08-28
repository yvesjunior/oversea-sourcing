import { redirect } from "@tanstack/react-router";
import { type PermissionKey } from "@/lib/roles";
import type { SessionData } from "@/lib/session-fns";

/** Routes reachable without a session. Everything else is default-deny
 *  (doc/BACKLOG.md — public landing, auth-gated app). */
const PUBLIC_PATHS = ["/", "/login", "/signup", "/mot-de-passe-oublie", "/reinitialiser", "/2fa"];
// /invitation/$id is public by design (B3): the id is the capability, and the
// invitee needs to see who invited them to what BEFORE having an account.
const PUBLIC_PREFIXES = ["/api/", "/invitation/"];

export function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PATHS.includes(pathname) || PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

/** Root-level guard: anonymous visitors on a protected path are sent to
 *  /login with a return target. Applied once in __root's beforeLoad —
 *  new routes are protected by default. */
export function enforceAuth(session: SessionData, pathname: string, href: string): void {
  if (!session && !isPublicPath(pathname)) {
    throw redirect({ to: "/login", search: { redirect: href } });
  }
}

/** Route guard for employee features (shared dashboard, role-gated).
 *  Buyers hitting an internal URL are sent home — the feature simply
 *  doesn't exist for them. Reads the session's resolved permission set
 *  (the Rôles & accès matrix, 2026-08-28) — server fns re-derive. */
export function requirePlatformFeature(session: SessionData, feature: PermissionKey): void {
  if (!hasSessionFeature(session, feature)) {
    throw redirect({ to: "/" });
  }
}

/** Client-side convenience over the session's resolved permission set. */
export function hasSessionFeature(session: SessionData, feature: PermissionKey): boolean {
  return session?.platformFeatures?.includes(feature) ?? false;
}
