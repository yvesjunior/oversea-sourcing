import { redirect } from "@tanstack/react-router";
import type { SessionData } from "@/lib/session-fns";

/** Routes reachable without a session. Everything else is default-deny
 *  (doc/BACKLOG.md — public landing, auth-gated app). */
const PUBLIC_PATHS = ["/", "/login", "/signup"];
const PUBLIC_PREFIXES = ["/api/"];

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
