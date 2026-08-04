import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// Single shared pool for the whole server process (web or worker).
// DATABASE_URL is provided by compose; the localhost fallback serves
// host-side tooling against the dev database.
const pool = new Pool({
  connectionString: process.env["DATABASE_URL"] ?? "postgres://osi:osi@localhost:5432/osi",
});

export const db = drizzle(pool, { schema });

export type Database = typeof db;
