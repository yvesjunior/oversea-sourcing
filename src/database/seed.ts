/**
 * Dev seed — demo accounts for local development. Idempotent.
 * Run inside the dev stack:  docker compose -f docker-compose.dev.yml exec web npm run db:seed
 *
 * Accounts (password for all: `osi-demo-1234`):
 *   owner@osi.dev       platform employee — owner (full control)
 *   manager@osi.dev     platform employee — manager (ops)
 *   accountant@osi.dev  platform employee — accountant (finance)
 *   buyer@osi.dev       regular buyer (own personal workspace)
 */
import { eq } from "drizzle-orm";
import { db } from "./index";
import * as schema from "./schema";
import { auth } from "../server/auth";

const PASSWORD = "osi-demo-1234";

// Named after their role on purpose — the dashboard greeting instantly tells
// you which account you are testing with ("Bonjour Manager,").
const comptes = [
  { email: "owner@osi.dev", name: "Owner", platformRole: "owner" },
  { email: "manager@osi.dev", name: "Manager", platformRole: "manager" },
  { email: "accountant@osi.dev", name: "Accountant", platformRole: "accountant" },
  { email: "buyer@osi.dev", name: "Buyer", platformRole: "user" },
] as const;

async function main() {
  for (const compte of comptes) {
    const existing = await db.query.user.findFirst({
      where: eq(schema.user.email, compte.email),
    });
    if (existing) {
      // Converge existing accounts to the desired name/role (idempotent upsert).
      await db
        .update(schema.user)
        .set({ name: compte.name, platformRole: compte.platformRole })
        .where(eq(schema.user.email, compte.email));
      console.log(`~ updated: ${compte.email} (${compte.name}, ${compte.platformRole})`);
      continue;
    }
    // Sign up through better-auth so password hashing and the personal
    // workspace hook behave exactly like production signups.
    await auth.api.signUpEmail({
      body: { email: compte.email, password: PASSWORD, name: compte.name, locale: "fr" },
    });
    if (compte.platformRole !== "user") {
      await db
        .update(schema.user)
        .set({ platformRole: compte.platformRole })
        .where(eq(schema.user.email, compte.email));
    }
    console.log(`+ created: ${compte.email} (${compte.platformRole})`);
  }
  console.log("Seed done. Password for all accounts: " + PASSWORD);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
