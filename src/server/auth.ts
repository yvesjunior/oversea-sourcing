import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { checkSignupPayload } from "@/lib/signup-guard";
import { orgAc, orgRoles } from "@/lib/org-access";
import { secondaryStorage } from "@/server/kv";
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
    // E1 (2026-08-23): password reset by email. The request endpoint answers
    // the same whether the account exists or not (no enumeration), and
    // /forget-password… — request-password-reset is rate limited below.
    sendResetPassword: async ({ user, url }) => {
      const { sendMail } = await import("@/server/mail");
      const fr = (user as { locale?: string }).locale !== "en";
      await sendMail({
        to: user.email,
        subject: fr ? "Réinitialisez votre mot de passe OSI" : "Reset your OSI password",
        text: fr
          ? `Réinitialisez votre mot de passe : ${url}\nCe lien expire dans 1 heure. Si vous n'avez rien demandé, ignorez cet e-mail.`
          : `Reset your password: ${url}\nThis link expires in 1 hour. If you didn't request this, ignore this email.`,
        html: fr
          ? `<p>Réinitialisez votre mot de passe OSI :</p><p><a href="${url}">Choisir un nouveau mot de passe</a></p><p style="color:#888;font-size:12px">Ce lien expire dans 1 heure. Si vous n'avez rien demandé, ignorez cet e-mail.</p>`
          : `<p>Reset your OSI password:</p><p><a href="${url}">Choose a new password</a></p><p style="color:#888;font-size:12px">This link expires in 1 hour. If you didn't request this, ignore this email.</p>`,
      });
    },
  },
  // E1 (2026-08-23): verification email on every email/password signup.
  // DELIBERATELY NOT ENFORCED at login (requireEmailVerification stays off):
  // prod has real unverified users, and locking them out would be a breaking
  // change — enforcement is a future product decision, the flag is recorded.
  // Google arrivals are verified by Google already (email_verified = true).
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      const { sendMail } = await import("@/server/mail");
      const fr = (user as { locale?: string }).locale !== "en";
      await sendMail({
        to: user.email,
        subject: fr ? "Confirmez votre adresse e-mail — OSI" : "Confirm your email address — OSI",
        text: fr
          ? `Bienvenue sur OSI ! Confirmez votre adresse : ${url}`
          : `Welcome to OSI! Confirm your address: ${url}`,
        html: fr
          ? `<p>Bienvenue sur OSI !</p><p><a href="${url}">Confirmer mon adresse e-mail</a></p>`
          : `<p>Welcome to OSI!</p><p><a href="${url}">Confirm my email address</a></p>`,
      });
    },
  },
  // With REDIS_URL set (the `cache` addon), counters live in Redis and add up
  // across web replicas; sessions stay in Postgres regardless — Redis is
  // disposable cache here, never state (fail-open wrappers in server/kv.ts).
  ...(secondaryStorage ? { secondaryStorage, session: { storeSessionInDatabase: true } } : {}),
  // Enabled explicitly: better-auth disables rate limiting in development by
  // default, which is exactly where we would fail to notice it not working.
  // Without REDIS_URL storage is in-memory — fine for exactly one web container.
  rateLimit: {
    enabled: true,
    ...(secondaryStorage ? { storage: "secondary-storage" as const } : {}),
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
      // Signup fork (2026-08-26): the account type must be one of ours, and
      // an organisation signup must carry the company name it will be named
      // after — this error IS user-facing (a form gap, not an attack).
      const body = ctx.body as { accountType?: unknown; companyName?: unknown };
      const accountType = body.accountType ?? "individual";
      if (accountType !== "individual" && accountType !== "organization") {
        throw new APIError("BAD_REQUEST", { message: "INVALID_ACCOUNT_TYPE" });
      }
      if (
        accountType === "organization" &&
        (typeof body.companyName !== "string" || body.companyName.trim().length < 2)
      ) {
        throw new APIError("BAD_REQUEST", { message: "COMPANY_NAME_REQUIRED" });
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
      // Signup fork (owner, 2026-08-26): individual | organization —
      // validated in the before-hook, consumed by the user-create hook.
      accountType: { type: "string", defaultValue: "individual", input: true },
      companyName: { type: "string", required: false, input: true },
    },
  },
  plugins: [
    organization({
      // Workspace roles: owner | buyer | viewer ("admin" schema-valid but
      // unminted since the 2026-08-23 merge; app guards rank it like buyer).
      // The AC lives in src/lib/org-access.ts, shared with the client plugin.
      ac: orgAc,
      roles: orgRoles,
      creatorRole: "owner",
      // B3 (2026-08-23): invitations via the plugin, 7 days, re-invite
      // replaces the pending one instead of erroring.
      invitationExpiresIn: 7 * 24 * 3600,
      cancelPendingInvitationsOnReInvite: true,
      sendInvitationEmail: async (data) => {
        const { sendMail } = await import("@/server/mail");
        const link = `${baseURL}/invitation/${data.id}`;
        const workspace = data.organization.name;
        const inviter = data.inviter.user.name || data.inviter.user.email;
        // Bilingual body: the invitee's locale is unknown until they have an
        // account, and FR is the product default.
        await sendMail({
          to: data.email,
          subject: `${inviter} vous invite sur OSI — ${workspace}`,
          text: `${inviter} vous invite à rejoindre l'espace « ${workspace} » sur OSI.\nAcceptez ici : ${link}\n\n${inviter} invited you to join the "${workspace}" workspace on OSI.\nAccept here: ${link}\n\nCe lien expire dans 7 jours / This link expires in 7 days.`,
          html: `<p>${inviter} vous invite à rejoindre l'espace « <strong>${workspace}</strong> » sur OSI.</p><p><a href="${link}">Accepter l'invitation</a></p><hr/><p>${inviter} invited you to join the "<strong>${workspace}</strong>" workspace on OSI.</p><p><a href="${link}">Accept the invitation</a></p><p style="color:#888;font-size:12px">Ce lien expire dans 7 jours · This link expires in 7 days</p>`,
        });
      },
      organizationHooks: {
        // Seat cap (B8): members + pending invitations may not exceed the
        // plan's max_members (0 = unlimited). Enforced INSIDE the plugin flow
        // so a direct call to the auth endpoint cannot bypass it.
        beforeCreateInvitation: async ({ invitation }) => {
          // One owner per workspace: ownership transfers, it is never invited.
          const role = String(invitation.role);
          if (role !== "buyer" && role !== "viewer") {
            throw new APIError("BAD_REQUEST", { message: "INVITE_ROLE_NOT_ALLOWED" });
          }
          const { assertSeatAvailable } = await import("@/server/workspace-guard");
          await assertSeatAvailable(invitation.organizationId, { countPending: true });
        },
        beforeAddMember: async ({ member }) => {
          const { assertSeatAvailable } = await import("@/server/workspace-guard");
          // creatorRole path (first member of a fresh workspace) always fits:
          // a new workspace has 0 members and every plan allows at least 1.
          await assertSeatAvailable(member.organizationId, { countPending: false });
        },
        // E9: tell the inviter their invitation landed.
        afterAcceptInvitation: async ({ invitation, member, organization: org }) => {
          const { notifyUser } = await import("@/server/notify");
          const joiner = await db.query.user.findFirst({
            where: eq(schema.user.id, member.userId),
          });
          await notifyUser({
            userId: invitation.inviterId,
            organizationId: org.id,
            type: "invitation_accepted",
            params: { name: joiner?.name ?? invitation.email, workspace: org.name },
            link: "/parametres",
          });
        },
        // Removal from your ONLY workspace deletes the account (owner
        // decision 2026-08-26, UC-6 re-interpreted): the tenant keeps the
        // work (request.created_by / file.uploaded_by null out to
        // "utilisateur supprimé"), the person re-registers if they ever
        // come back. Guards: never auto-delete platform staff, and never a
        // user who still belongs somewhere (an individual invited into an
        // org and removed later simply falls back to their own workspace).
        afterRemoveMember: async ({ member }) => {
          const [remaining, removedUser] = await Promise.all([
            db.query.member.findFirst({ where: eq(schema.member.userId, member.userId) }),
            db.query.user.findFirst({ where: eq(schema.user.id, member.userId) }),
          ]);
          if (remaining || !removedUser || removedUser.platformRole !== "user") return;
          await db.delete(schema.user).where(eq(schema.user.id, member.userId));
          console.log(
            `member removal: last workspace of ${removedUser.email} — account deleted (UC-6 re-interpretation, 2026-08-26)`,
          );
        },
        // Role edits from the team screen: never touch the owner, never mint
        // one — ownership moves only through the transfer flow (B7).
        beforeUpdateMemberRole: async ({ member, newRole }) => {
          if (member.role === "owner" || String(newRole) === "owner") {
            throw new APIError("BAD_REQUEST", { message: "OWNER_ROLE_IS_TRANSFERRED_NOT_EDITED" });
          }
          if (String(newRole) !== "buyer" && String(newRole) !== "viewer") {
            throw new APIError("BAD_REQUEST", { message: "INVITE_ROLE_NOT_ALLOWED" });
          }
        },
      },
    }),
  ],
  databaseHooks: {
    user: {
      create: {
        // Every new user gets a personal workspace — solo users are isolated
        // by construction (doc/BACKLOG.md).
        after: async (newUser) => {
          // Q1 (decided 2026-08-22): people who sign up THROUGH an invitation
          // are joining an enterprise — they get no personal workspace. A
          // pending invitation for this email is the signal.
          const invited = await db.query.invitation.findFirst({
            where: (fields, { and: andOp, eq: eqOp, gt }) =>
              andOp(
                eqOp(fields.email, newUser.email.toLowerCase()),
                eqOp(fields.status, "pending"),
                gt(fields.expiresAt, new Date()),
              ),
          });
          if (invited) return;

          // Signup fork (owner, 2026-08-26): ONE workspace per account.
          // Organisation signups get a company workspace named after the
          // company — and NO personal workspace (same reasoning as Q1: dual
          // workspaces mean dual free allowances). Social signups carry no
          // accountType and default to individual.
          const intent = newUser as { accountType?: string; companyName?: string | null };
          const isOrganisation =
            intent.accountType === "organization" && !!intent.companyName?.trim();

          const orgId = crypto.randomUUID();
          const suffix = orgId.slice(0, 6);
          const workspaceName = isOrganisation
            ? intent.companyName!.trim().slice(0, 80)
            : newUser.name || newUser.email.split("@")[0] || "Workspace";
          await db.insert(schema.organization).values({
            id: orgId,
            name: workspaceName,
            slug: `${slugify(isOrganisation ? workspaceName : (newUser.email.split("@")[0] ?? "workspace"))}-${suffix}`,
            type: isOrganisation ? "enterprise" : "individual",
            createdAt: new Date(),
          });
          await db.insert(schema.member).values({
            id: crypto.randomUUID(),
            organizationId: orgId,
            userId: newUser.id,
            role: "owner",
            createdAt: new Date(),
          });
          // Put the new workspace on its trial plan. Without this the
          // workspace has no subscription, resolvePlan falls back to the env
          // defaults, and the daily quota is silently UNLIMITED — the
          // migration only seeded subscriptions for workspaces that existed
          // when it ran. Applies to every signup route, social included.
          // Organisations start on org_trial (Free-like, 3 seats); the free
          // fallback keeps a missing row from silently unlimiting anyone.
          const planCode = isOrganisation ? "org_trial" : "free";
          const trialPlan =
            (await db.query.plan.findFirst({ where: eq(schema.plan.code, planCode) })) ??
            (await db.query.plan.findFirst({ where: eq(schema.plan.code, "free") }));
          if (trialPlan) {
            await db
              .insert(schema.subscription)
              .values({
                id: crypto.randomUUID(),
                organizationId: orgId,
                planId: trialPlan.id,
                status: "active",
              })
              .onConflictDoNothing({ target: schema.subscription.organizationId });
          }
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
