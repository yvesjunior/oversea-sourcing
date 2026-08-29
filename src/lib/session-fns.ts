import { createServerFn } from "@tanstack/react-start";
import type { Auth } from "@/server/auth"; // type-only: erased at compile time
import type { PermissionKey } from "@/lib/roles";
import {
  DEFAULT_LANGUAGE,
  languageFromCookie,
  resolveLanguage,
  type Language,
} from "@/i18n/config";
import { DEFAULT_DESIGN, designFromCookie, resolveDesign, type Design } from "@/lib/themes";

/** The session the client sees, extended with the resolved staff permission
 *  set (2026-08-28) — presentation only, server fns re-derive per call. */
export type SessionData =
  (Auth["$Infer"]["Session"] & { platformFeatures: PermissionKey[] }) | null;

// Server-only modules are dynamically imported INSIDE handlers: the Start
// compiler extracts handler bodies into the server bundle, so `src/server/**`
// never leaks into the client graph (import-protection).

/** What __root's beforeLoad puts in the router context. The LANGUAGE rides
 *  along (2026-08-29) because it is resolved from the request cookie, which
 *  only the server can read — and SSR must render in it, or hydration breaks
 *  (see src/i18n/config.ts). One round trip, not two. */
export type RootContext = { session: SessionData; lang: Language; design: Design };

/** Session (user + session) for the current request — null when anonymous —
 *  plus the language this request must be rendered in.
 *  Precedence: the cookie the visitor chose, then the account's saved locale
 *  (a new device gets the user's own language before the default), then FR. */
export const getSessionFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<RootContext> => {
    const [{ auth }, { getRequest }] = await Promise.all([
      import("@/server/auth"),
      import("@tanstack/react-start/server"),
    ]);
    const headers = getRequest().headers;
    const cookie = headers.get("cookie");
    const cookieLang = languageFromCookie(cookie);
    const cookieDesign = designFromCookie(cookie);
    const session = await auth.api.getSession({ headers });
    if (!session) {
      return {
        session: null,
        lang: cookieLang ?? DEFAULT_LANGUAGE,
        design: cookieDesign ?? DEFAULT_DESIGN,
      };
    }
    const account = session.user as { locale?: string; design?: string };
    const lang = cookieLang ?? resolveLanguage(account.locale ?? null);
    const design = cookieDesign ?? resolveDesign(account.design ?? null);
    // The client sees the EFFECTIVE role (2026-08-27): staff powers exist
    // only while standing in the internal workspace, so all client-side
    // gating (sidebar, Vue globale tabs, route guards) follows the badge
    // with zero per-component logic. Server fns re-derive it themselves —
    // this field is presentation, never authority.
    const { effectivePlatformRole } = await import("@/server/workspace-guard");
    const effective = await effectivePlatformRole(session);
    // Staff permissions are data since 2026-08-28 — ship the resolved set so
    // nav and route guards follow the Rôles & accès matrix automatically.
    const { grantedFeatures } = await import("@/server/permissions");
    const platformFeatures = await grantedFeatures(effective);
    return {
      session: {
        ...session,
        user: { ...session.user, platformRole: effective },
        platformFeatures,
      },
      lang,
      design,
    };
  },
);

/** Public auth configuration the login/signup pages need.
 *  quickLoginEnabled: SHOW_TEST_LOGIN=true surfaces the one-click demo-account
 *  box outside dev builds (test phases — the seeded credentials are public). */
export const getAuthConfigFn = createServerFn({ method: "GET" }).handler(async () => {
  const { isGoogleEnabled } = await import("@/server/auth");
  return {
    googleEnabled: isGoogleEnabled,
    quickLoginEnabled: process.env["SHOW_TEST_LOGIN"] === "true",
  };
});
