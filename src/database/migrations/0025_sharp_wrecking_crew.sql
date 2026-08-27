ALTER TABLE "request" ADD COLUMN "created_by_name" text;--> statement-breakpoint
-- Backfill the attribution snapshot for every request whose creator still
-- exists (rows whose creator is already gone stay null — displayed as
-- "utilisateur supprimé").
UPDATE "request" r SET "created_by_name" = u."name"
FROM "user" u WHERE u."id" = r."created_by" AND r."created_by_name" IS NULL;
--> statement-breakpoint
-- Organisation names are UNIQUE (owner, 2026-08-26) — company identity must
-- be unambiguous. Case-insensitive, enterprise + internal workspaces only:
-- personal workspaces are named after people and collide legitimately.
CREATE UNIQUE INDEX IF NOT EXISTS "organization_name_company_uq"
ON "organization" (lower("name")) WHERE "type" IN ('enterprise', 'internal');
