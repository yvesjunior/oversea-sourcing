CREATE TABLE "plan" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"requests_per_day" integer DEFAULT 1 NOT NULL,
	"suppliers_returned" integer DEFAULT 5 NOT NULL,
	"model_tier" text DEFAULT 'cheap' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"updated_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"current_period_end" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plan" ADD CONSTRAINT "plan_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription" ADD CONSTRAINT "subscription_plan_id_plan_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plan"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plan_code_uq" ON "plan" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_org_uq" ON "subscription" USING btree ("organization_id");--> statement-breakpoint
-- Seed the plans here rather than in the seed script: production runs migrations
-- on every deploy but never runs `db:seed`, so seeding there would leave prod
-- with an empty plan table and every workspace silently on the env fallback.
-- requests_per_day = 0 means unlimited.
INSERT INTO "plan" ("id", "code", "name", "requests_per_day", "suppliers_returned", "model_tier", "position")
VALUES
  ('plan-free',     'free',     'Free',     1,  5,  'cheap', 1),
  ('plan-pro',      'pro',      'Pro',      10, 10, 'best',  2),
  ('plan-business', 'business', 'Business', 50, 20, 'best',  3),
  ('plan-internal', 'internal', 'Internal', 0,  10, 'best',  4)
ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
-- Every existing workspace starts on Free; demo/staff workspaces are moved to
-- Internal below so a public demo login cannot burn the daily allowance.
INSERT INTO "subscription" ("id", "organization_id", "plan_id", "status")
SELECT 'sub-' || o."id", o."id", 'plan-free', 'active' FROM "organization" o
ON CONFLICT ("organization_id") DO NOTHING;--> statement-breakpoint
UPDATE "subscription" s SET "plan_id" = 'plan-internal'
FROM "member" m JOIN "user" u ON u."id" = m."user_id"
WHERE m."organization_id" = s."organization_id"
  AND (u."platform_role" <> 'user' OR u."email" LIKE '%@osi.dev');
