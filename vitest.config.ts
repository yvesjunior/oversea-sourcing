import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit tests only (A7): pure logic — matching, dedup keys, the store-first
// qualifier, connector contract (agent mocked). Anything needing Postgres or
// Redis stays out of `npm test` and is verified against the dev stack instead
// (see doc/BACKLOG.md A7 notes).
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
