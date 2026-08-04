import { createAuthClient } from "better-auth/react";
import { inferAdditionalFields, organizationClient } from "better-auth/client/plugins";
import type { Auth } from "@/server/auth";

export const authClient = createAuthClient({
  plugins: [organizationClient(), inferAdditionalFields<Auth>()],
});

export const { signIn, signUp, signOut, useSession } = authClient;
