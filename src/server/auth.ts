import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";

const googleClientId = process.env["GOOGLE_CLIENT_ID"];
const googleClientSecret = process.env["GOOGLE_CLIENT_SECRET"];

/** Google sign-in is optional: enabled only when credentials are configured
 *  (dev: localhost redirect works today; prod: needs domain + TLS first). */
export const isGoogleEnabled = Boolean(googleClientId && googleClientSecret);

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "workspace"
  );
}

export const auth = betterAuth({
  baseURL: process.env["BETTER_AUTH_URL"] ?? "http://localhost:3010",
  secret: process.env["BETTER_AUTH_SECRET"] ?? "osi-dev-insecure-secret",
  database: drizzleAdapter(db, { provider: "pg", schema }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  ...(isGoogleEnabled
    ? {
        socialProviders: {
          google: { clientId: googleClientId!, clientSecret: googleClientSecret! },
        },
      }
    : {}),
  user: {
    additionalFields: {
      locale: { type: "string", defaultValue: "fr", input: true },
      platformRole: { type: "string", defaultValue: "user", input: false },
    },
  },
  plugins: [
    organization({
      // Workspace roles: owner | admin | buyer | viewer (buyer/viewer enforced
      // in app guards; plugin stores the role string on the membership).
      creatorRole: "owner",
    }),
  ],
  databaseHooks: {
    user: {
      create: {
        // Every new user gets a personal workspace — solo users are isolated
        // by construction (doc/BACKLOG.md).
        after: async (newUser) => {
          const orgId = crypto.randomUUID();
          const suffix = orgId.slice(0, 6);
          await db.insert(schema.organization).values({
            id: orgId,
            name: newUser.name || newUser.email.split("@")[0] || "Workspace",
            slug: `${slugify(newUser.email.split("@")[0] ?? "workspace")}-${suffix}`,
            createdAt: new Date(),
          });
          await db.insert(schema.member).values({
            id: crypto.randomUUID(),
            organizationId: orgId,
            userId: newUser.id,
            role: "owner",
            createdAt: new Date(),
          });
        },
      },
    },
    session: {
      create: {
        // New sessions start in the user's first workspace.
        before: async (newSession) => {
          const membership = await db.query.member.findFirst({
            where: eq(schema.member.userId, newSession.userId),
          });
          return {
            data: { ...newSession, activeOrganizationId: membership?.organizationId ?? null },
          };
        },
      },
    },
  },
});

export type Auth = typeof auth;
