import { defineConfig } from "drizzle-kit";

// DATABASE_URL is injected by compose (dev: hardcoded dev creds; prod: .env.local).
// The localhost fallback serves host-side tooling (drizzle-kit studio/generate)
// against the dev database exposed on 127.0.0.1:5432.
export default defineConfig({
  schema: "./src/database/schema.ts",
  out: "./src/database/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env["DATABASE_URL"] ?? "postgres://osi:osi@localhost:5432/osi",
  },
});
