import { createServerFn } from "@tanstack/react-start";
import type { Auth } from "@/server/auth"; // type-only: erased at compile time

export type SessionData = Auth["$Infer"]["Session"] | null;

// Server-only modules are dynamically imported INSIDE handlers: the Start
// compiler extracts handler bodies into the server bundle, so `src/server/**`
// never leaks into the client graph (import-protection).

/** Session (user + session) for the current request, or null when anonymous.
 *  Loaded into the router context by __root's beforeLoad. */
export const getSessionFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<SessionData> => {
    const [{ auth }, { getRequest }] = await Promise.all([
      import("@/server/auth"),
      import("@tanstack/react-start/server"),
    ]);
    return auth.api.getSession({ headers: getRequest().headers });
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
