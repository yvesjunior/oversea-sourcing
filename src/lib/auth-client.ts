import { createAuthClient } from "better-auth/react";
import { inferAdditionalFields, organizationClient } from "better-auth/client/plugins";
import { orgAc, orgRoles } from "@/lib/org-access";
import type { Auth } from "@/server/auth";

export const authClient = createAuthClient({
  plugins: [
    // Same AC as the server plugin — the client types then accept our roles
    // (owner | buyer | viewer) on invite/updateMemberRole.
    organizationClient({ ac: orgAc, roles: orgRoles }),
    inferAdditionalFields<Auth>(),
  ],
});

export const { signIn, signUp, signOut, useSession } = authClient;
