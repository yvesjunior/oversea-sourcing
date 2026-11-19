import { createServerFn } from "@tanstack/react-start";
import type { Auth } from "@/server/auth"; // type-only: erased at compile time
import type { ExternalAccountType } from "@/lib/account-types";
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
  | (Auth["$Infer"]["Session"] & {
      platformFeatures: PermissionKey[];
      /** Set when this is an EXTERNAL account's session (V03) — a supplier's
       *  or a partner's person. Such a session stands in no workspace and has
       *  no staff feature; the root guard sends it to `/portail` and nowhere
       *  else. Null for a workspace account, i.e. everyone before V03. */
      external: ExternalAccountType | null;
    })
  | null;

// Server-only modules are dynamically imported INSIDE handlers: the Start
// compiler extracts handler bodies into the server bundle, so `src/server/**`
// never leaks into the client graph (import-protection).

/** What __root's beforeLoad puts in the router context. The LANGUAGE rides
 *  along (2026-08-29) because it is resolved from the request cookie, which
 *  only the server can read — and SSR must render in it, or hydration breaks
 *  (see src/i18n/config.ts). One round trip, not two. */
export type RootContext = {
  session: SessionData;
  lang: Language;
  design: Design;
  /** The active workspace is archived — every route but the recovery screen is
   *  closed until its owner brings it back (2026-09-12). */
  archivedWorkspace: { id: string; name: string; archivedAt: string } | null;
};

/** Session (user + session) for the current request — null when anonymous —
 *  plus the language this request must be rendered in.
 *  Precedence: the cookie the visitor chose, then the account's saved locale
 *  (a new device gets the user's own language before the default), then FR. */
export const getSessionFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<RootContext> => {
    // `getAnySession`, not `auth.api.getSession`: this is the ONE workspace-side
    // function that must recognise an external account, because it is what
    // tells the router to send that account to the portal. Listed as such in
    // src/lib/external-access.ts.
    const [{ getAnySession }, { getRequest }] = await Promise.all([
      import("@/server/auth"),
      import("@tanstack/react-start/server"),
    ]);
    const headers = getRequest().headers;
    const cookie = headers.get("cookie");
    const cookieLang = languageFromCookie(cookie);
    const cookieDesign = designFromCookie(cookie);
    const session = await getAnySession(headers);
    if (!session) {
      return {
        session: null,
        lang: cookieLang ?? DEFAULT_LANGUAGE,
        design: cookieDesign ?? DEFAULT_DESIGN,
        archivedWorkspace: null,
      };
    }
    const account = session.user as { locale?: string; design?: string; accountType?: string };
    const lang = cookieLang ?? resolveLanguage(account.locale ?? null);
    const design = cookieDesign ?? resolveDesign(account.design ?? null);

    // An external account (V03): no workspace to look up, no staff role, no
    // feature. Returned before any of the workspace code below is reached.
    const { externalKind, isExternalAccount } = await import("@/lib/account-types");
    if (isExternalAccount(account.accountType)) {
      return {
        session: {
          ...session,
          user: { ...session.user, platformRole: "user" },
          platformFeatures: [],
          // An account type nobody recognises is treated as external and
          // shown as the kind with the least: it reaches the portal, where
          // `requireSupplierSession` grants it nothing.
          external: externalKind(account.accountType) ?? "supplier",
        },
        lang,
        design,
        archivedWorkspace: null,
      };
    }
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
    // Signing in to a workspace whose owner deleted it: the data is intact and
    // one click away, so the session is NOT refused — it lands on recovery.
    const workspaceId = session.session.activeOrganizationId;
    let archivedWorkspace: RootContext["archivedWorkspace"] = null;
    if (workspaceId) {
      const [{ db }, { eq }, schema] = await Promise.all([
        import("@/database"),
        import("drizzle-orm"),
        import("@/database/schema"),
      ]);
      const workspace = await db.query.organization.findFirst({
        where: eq(schema.organization.id, workspaceId),
        columns: { id: true, name: true, archivedAt: true },
      });
      if (workspace?.archivedAt) {
        archivedWorkspace = {
          id: workspace.id,
          name: workspace.name,
          archivedAt: workspace.archivedAt.toISOString(),
        };
      }
    }

    return {
      session: {
        ...session,
        user: { ...session.user, platformRole: effective },
        platformFeatures,
        external: null,
      },
      lang,
      design,
      archivedWorkspace,
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
