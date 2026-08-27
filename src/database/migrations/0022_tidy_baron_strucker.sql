ALTER TABLE "organization" ADD COLUMN "type" text DEFAULT 'individual' NOT NULL;
--> statement-breakpoint
-- The staff workspace (owner, 2026-08-26): one default organisation named in
-- full, "Oversea Sourcing Intelligence", type 'internal', holding every
-- platform staff member. Seeded in a migration because prod never runs
-- db:seed. Guarded so re-running (or a pre-existing prod org) is safe.
INSERT INTO "organization" ("id", "name", "slug", "type", "created_at")
SELECT 'org-osi-internal', 'Oversea Sourcing Intelligence', 'osi', 'internal', now()
WHERE NOT EXISTS (SELECT 1 FROM "organization" WHERE "slug" = 'osi');
--> statement-breakpoint
-- Every platform staff member joins it: the (single) platform owner as the
-- workspace owner, other staff as buyers (they can run test requests; the
-- one-owner-per-workspace rule holds).
INSERT INTO "member" ("id", "organization_id", "user_id", "role", "created_at")
SELECT gen_random_uuid()::text,
       (SELECT "id" FROM "organization" WHERE "slug" = 'osi'),
       u."id",
       CASE WHEN u."platform_role" = 'owner' THEN 'owner' ELSE 'buyer' END,
       now()
FROM "user" u
WHERE u."platform_role" IN ('owner', 'manager', 'accountant')
  AND NOT EXISTS (
    SELECT 1 FROM "member" m
    WHERE m."organization_id" = (SELECT "id" FROM "organization" WHERE "slug" = 'osi')
      AND m."user_id" = u."id"
  );
--> statement-breakpoint
-- The staff workspace runs on the internal plan (unlimited), like the other
-- staff workspaces moved there on 2026-08-20.
INSERT INTO "subscription" ("id", "organization_id", "plan_id", "status", "created_at", "updated_at")
SELECT gen_random_uuid()::text,
       (SELECT "id" FROM "organization" WHERE "slug" = 'osi'),
       (SELECT "id" FROM "plan" WHERE "code" = 'internal' LIMIT 1),
       'active', now(), now()
WHERE EXISTS (SELECT 1 FROM "plan" WHERE "code" = 'internal')
  AND NOT EXISTS (
    SELECT 1 FROM "subscription"
    WHERE "organization_id" = (SELECT "id" FROM "organization" WHERE "slug" = 'osi')
  );
--> statement-breakpoint
-- Backfill types for existing workspaces: nothing enterprise exists yet
-- anywhere (enterprise creation is staff-assisted and unused) — every
-- pre-existing workspace is a personal one, so the 'individual' default
-- already covers them; only the staff org above carries 'internal'.
UPDATE "organization" SET "type" = 'internal' WHERE "slug" = 'osi';
