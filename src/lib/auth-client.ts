import { createAuthClient } from "better-auth/react";
import {
  inferAdditionalFields,
  organizationClient,
  twoFactorClient,
} from "better-auth/client/plugins";
import { orgAc, orgRoles } from "@/lib/org-access";
import type { Auth } from "@/server/auth";

export const authClient = createAuthClient({
  plugins: [
    // Same AC as the server plugin — the client types then accept our roles
    // (owner | buyer | viewer) on invite/updateMemberRole.
    organizationClient({ ac: orgAc, roles: orgRoles }),
    // 2FA: a sign-in that needs a code lands on the /2fa page (full page
    // load — the half-authenticated state must not keep SPA session state).
    twoFactorClient({
      onTwoFactorRedirect() {
        window.location.href = "/2fa";
      },
    }),
    inferAdditionalFields<Auth>(),
  ],
});

export const { signIn, signUp, signOut, useSession } = authClient;
