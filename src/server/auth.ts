import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { checkSignupPayload } from "@/lib/signup-guard";
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

const baseURL = process.env["BETTER_AUTH_URL"] ?? "http://localhost:3010";
// Cloudflare serves the app on both the apex and www — trust both origins so
// logins work regardless of which host the visitor landed on.
const wwwVariant = baseURL.includes("://www.") ? null : baseURL.replace("://", "://www.");
// Real domain (not localhost/IP) ⇒ share the session cookie across subdomains.
const isPublicHost = /\.[a-z]{2,}$/i.test(new URL(baseURL).hostname);

export const auth = betterAuth({
  baseURL,
  trustedOrigins: wwwVariant ? [wwwVariant] : [],
  secret: process.env["BETTER_AUTH_SECRET"] ?? "osi-dev-insecure-secret",
  database: drizzleAdapter(db, { provider: "pg", schema }),
  advanced: {
    ipAddress: {
      // Prod sits behind a Cloudflare Tunnel: the socket peer is the local
      // cloudflared container, so without this every visitor shared ONE
      // rate-limit bucket (collective 429s on /sign-in). cf-connecting-ip is
      // set by Cloudflare and not client-spoofable; x-forwarded-for covers
      // other proxies; absent headers fall back to the socket (dev).
      ipAddressHeaders: ["cf-connecting-ip", "x-forwarded-for"],
    },
    // One login valid on apex AND www: the session cookie is set on the root
    // domain (`.osi-solutions.com`, derived from BETTER_AUTH_URL) instead of
    // the exact host. Disabled on localhost (dev).
    crossSubDomainCookies: { enabled: isPublicHost },
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
  },
  // Enabled explicitly: better-auth disables rate limiting in development by
  // default, which is exactly where we would fail to notice it not working.
  // Storage is in-memory — fine for one container; INFRA §8 flags Redis as the
  // swap when the web tier is replicated, since per-process counters do not add up.
  rateLimit: {
    enabled: true,
    window: 60,
    max: 60,
    customRules: {
      // Account creation is the expensive one: every signup makes a workspace,
      // and any account can spend API budget once AI_RESEARCH is on.
      "/sign-up/email": { window: 3600, max: 3 },
      "/sign-in/email": { window: 300, max: 10 },
      "/forget-password": { window: 3600, max: 3 },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-up/email") return;
      const rejection = checkSignupPayload(ctx.body);
      if (rejection) {
        // Logged with the real reason, answered with a generic one — the client
        // must not learn which check it tripped.
        console.warn(`signup rejected (${rejection.reason})`);
        throw new APIError("BAD_REQUEST", { message: rejection.message });
      }
    }),
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
