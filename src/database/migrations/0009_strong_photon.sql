ALTER TABLE "plan" ADD COLUMN "max_requests_total" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "plan" ADD COLUMN "max_members" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "plan" ADD COLUMN "quota_scope" text DEFAULT 'workspace' NOT NULL;--> statement-breakpoint
ALTER TABLE "plan" ADD COLUMN "audience" text DEFAULT 'individual' NOT NULL;
--> statement-breakpoint
UPDATE "plan" SET "audience" = 'individual', "quota_scope" = 'user', "max_members" = 1, "max_requests_total" = 2 WHERE "code" = 'free';
--> statement-breakpoint
UPDATE "plan" SET "audience" = 'individual', "quota_scope" = 'user', "max_members" = 1, "max_requests_total" = 0 WHERE "code" = 'pro';
--> statement-breakpoint
UPDATE "plan" SET "audience" = 'organization', "quota_scope" = 'workspace', "max_members" = 5, "max_requests_total" = 0 WHERE "code" = 'business';
--> statement-breakpoint
UPDATE "plan" SET "audience" = 'internal', "quota_scope" = 'workspace', "max_members" = 0, "max_requests_total" = 0 WHERE "code" = 'internal';
--> statement-breakpoint
INSERT INTO "plan" ("id", "code", "name", "requests_per_day", "max_requests_total", "max_members", "quota_scope", "audience", "suppliers_returned", "model_tier", "position")
VALUES ('plan-enterprise', 'enterprise', 'Enterprise', 100, 0, 0, 'workspace', 'organization', 20, 'best', 4)
ON CONFLICT DO NOTHING;
