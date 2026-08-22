CREATE TABLE "data_source" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"country_code" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"config" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_run" (
	"id" text PRIMARY KEY NOT NULL,
	"data_source_id" text NOT NULL,
	"trigger" text NOT NULL,
	"request_id" text,
	"triggered_by" text,
	"status" text DEFAULT 'running' NOT NULL,
	"scope" jsonb,
	"candidates_found" integer DEFAULT 0 NOT NULL,
	"suppliers_added" integer DEFAULT 0 NOT NULL,
	"memberships_upserted" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "sourcing_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"activated_source_ids" jsonb,
	"country_mode" text DEFAULT 'global' NOT NULL,
	"country_codes" jsonb,
	"updated_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_source" (
	"id" text PRIMARY KEY NOT NULL,
	"supplier_id" text NOT NULL,
	"data_source_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"payload" jsonb,
	"banned_by" text,
	"banned_reason" text
);
--> statement-breakpoint
ALTER TABLE "research_run" ADD COLUMN "fingerprint" text;--> statement-breakpoint
ALTER TABLE "supplier" ADD COLUMN "last_researched_at" timestamp;--> statement-breakpoint
ALTER TABLE "supplier" ADD COLUMN "banned_at" timestamp;--> statement-breakpoint
ALTER TABLE "supplier" ADD COLUMN "banned_by" text;--> statement-breakpoint
ALTER TABLE "supplier" ADD COLUMN "banned_reason" text;--> statement-breakpoint
ALTER TABLE "source_run" ADD CONSTRAINT "source_run_data_source_id_data_source_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_run" ADD CONSTRAINT "source_run_request_id_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."request"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_run" ADD CONSTRAINT "source_run_triggered_by_user_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourcing_rules" ADD CONSTRAINT "sourcing_rules_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourcing_rules" ADD CONSTRAINT "sourcing_rules_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_source" ADD CONSTRAINT "supplier_source_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_source" ADD CONSTRAINT "supplier_source_data_source_id_data_source_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_source" ADD CONSTRAINT "supplier_source_banned_by_user_id_fk" FOREIGN KEY ("banned_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "data_source_code_uq" ON "data_source" USING btree ("code");--> statement-breakpoint
CREATE INDEX "source_run_source_idx" ON "source_run" USING btree ("data_source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sourcing_rules_org_uq" ON "sourcing_rules" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_source_pair_uq" ON "supplier_source" USING btree ("supplier_id","data_source_id");--> statement-breakpoint
CREATE INDEX "supplier_source_source_idx" ON "supplier_source" USING btree ("data_source_id");--> statement-breakpoint
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_banned_by_user_id_fk" FOREIGN KEY ("banned_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
INSERT INTO "data_source" ("id", "code", "name", "type", "country_code", "enabled")
VALUES ('ds-global-web', 'global_web', 'Recherche web mondiale (IA)', 'global_web', NULL, true)
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "supplier_source" ("id", "supplier_id", "data_source_id", "status", "first_seen_at", "last_seen_at")
SELECT 'ss-gw-' || s."id", s."id", 'ds-global-web', 'active', s."created_at", s."created_at"
FROM "supplier" s
ON CONFLICT DO NOTHING;
--> statement-breakpoint
UPDATE "supplier" SET "last_researched_at" = "created_at" WHERE "last_researched_at" IS NULL;
