ALTER TABLE "data_source" ADD COLUMN "role" text DEFAULT 'discovery' NOT NULL;
--> statement-breakpoint
-- ADR-001 (2026-08-26): registries are verification infrastructure — never
-- fed into matching, never workspace-selectable. Their stores stay as local
-- verification lookup tables (scheduled refresh ~6 months). global_web (and
-- future customs/marketplace connectors) keep the default 'discovery'.
UPDATE "data_source" SET "role" = 'verification' WHERE "type" = 'country_registry';
