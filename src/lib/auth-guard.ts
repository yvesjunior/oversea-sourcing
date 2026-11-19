import { redirect } from "@tanstack/react-router";
import { externalHome, externalMayOpen, isExternalSurfacePath } from "@/lib/account-types";
import { type PermissionKey } from "@/lib/roles";
import type { SessionData } from "@/lib/session-fns";

/** Routes reachable without a session. Everything else is default-deny
 *  (BACKLOG.md — public landing, auth-gated app). */
const PUBLIC_PATHS = ["/", "/login", "/signup", "/mot-de-passe-oublie", "/reinitialiser", "/2fa"];
// /invitation/$id is public by design (B3): the id is the capability, and the
// invitee needs to see who invited them to what BEFORE having an account.
// /portail/inscription/$token likewise (V15): the token in the path is the
// capability — the link in an RFQ email — and its reader has no account yet.
// /partenaires/inscription/$token is the same thing for a partner (V23).
const PUBLIC_PREFIXES = [
  "/api/",
  "/invitation/",
  "/portail/inscription/",
  "/partenaires/inscription/",
];

export function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PATHS.includes(pathname) || PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  );
}

/** Root-level guard: anonymous visitors on a protected path are sent to
 *  /login with a return target. Applied once in __root's beforeLoad —
 *  new routes are protected by default. */
export function enforceAuth(session: SessionData, pathname: string, href: string): void {
  const target = authRedirect(session, pathname);
  if (target === "login") throw redirect({ to: "/login", search: { redirect: href } });
  if (target === "portal") throw redirect({ to: externalHome("supplier") });
  if (target === "hub") throw redirect({ to: externalHome("partner") });
  if (target === "home") throw redirect({ to: "/" });
}

/**
 * Where the root guard sends this session for this path — null when it may
 * stay. Pure, so the three populations can be tested without a router:
 *
 *   anonymous   public paths only; everything else → login.
 *   external    (a supplier's or a partner's person, V03) ITS surface — the
 *               portal for a supplier, the Partner Hub for a partner (V23) —
 *               and the few account pages; EVERYTHING else, the other
 *               surface included → its own. Decided here, before any loader
 *               runs: the loaders of buyer pages call workspace functions,
 *               and those refuse an external session by throwing.
 *   workspace   everything except the two external surfaces → home.
 */
export function authRedirect(
  session: SessionData,
  pathname: string,
): "login" | "portal" | "hub" | "home" | null {
  if (!session) return isPublicPath(pathname) ? null : "login";
  if (session.external) {
    if (externalMayOpen(pathname, session.external)) return null;
    return session.external === "partner" ? "hub" : "portal";
  }
  // A public page under a surface (the invitation links, V15 and V23) stays
  // open to a signed-in buyer or staff member: they may be the one invited.
  if (isExternalSurfacePath(pathname) && !isPublicPath(pathname)) return "home";
  return null;
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
