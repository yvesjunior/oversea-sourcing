CREATE TABLE "research_run" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"queries" jsonb,
	"candidates_found" integer DEFAULT 0 NOT NULL,
	"suppliers_added" integer DEFAULT 0 NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "supplier" ADD COLUMN "source_ref" text;--> statement-breakpoint
ALTER TABLE "supplier" ADD COLUMN "dedup_key" text;--> statement-breakpoint
-- Backfill (hand-added): rows that predate E4 need a dedup key too, or the
-- research agent would happily re-add a supplier we already have. Mirrors
-- supplierDedupKey() in src/lib/supplier-key.ts for the simple case — existing
-- names carry no accents or legal suffixes. Re-running the seed converges the
-- rest.
UPDATE "supplier"
SET "dedup_key" = lower(regexp_replace("name", '[^a-zA-Z0-9]+', '', 'g')) || '|' || upper("country_code")
WHERE "dedup_key" IS NULL;--> statement-breakpoint
ALTER TABLE "research_run" ADD CONSTRAINT "research_run_request_id_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "research_run_request_idx" ON "research_run" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_dedup_key_uq" ON "supplier" USING btree ("dedup_key");