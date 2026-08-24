CREATE TABLE "source_record" (
	"id" text PRIMARY KEY NOT NULL,
	"data_source_id" text NOT NULL,
	"dedup_key" text NOT NULL,
	"supplier_id" text,
	"name" text NOT NULL,
	"descriptor" text,
	"country_code" text NOT NULL,
	"website" text,
	"description" text,
	"confidence_score" integer DEFAULT 50 NOT NULL,
	"source_url" text,
	"payload" jsonb,
	"status" text DEFAULT 'active' NOT NULL,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"banned_by" text,
	"banned_reason" text
);
--> statement-breakpoint
ALTER TABLE "source_record" ADD CONSTRAINT "source_record_data_source_id_data_source_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_source"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_record" ADD CONSTRAINT "source_record_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_record" ADD CONSTRAINT "source_record_banned_by_user_id_fk" FOREIGN KEY ("banned_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "source_record_source_key_uq" ON "source_record" USING btree ("data_source_id","dedup_key");--> statement-breakpoint
CREATE INDEX "source_record_source_idx" ON "source_record" USING btree ("data_source_id");--> statement-breakpoint
CREATE INDEX "source_record_supplier_idx" ON "source_record" USING btree ("supplier_id");--> statement-breakpoint
-- Phase D backfill: every existing supplier_source membership becomes a
-- PROMOTED record (supplier_id kept) — these companies were already surfaced
-- under the old model, so they stay load-bearing. Descriptive fields are
-- copied from the supplier row; suppliers without a dedup_key (legacy seeds)
-- get a stable synthetic one so the per-source unique index holds.
INSERT INTO "source_record" (
	"id", "data_source_id", "dedup_key", "supplier_id", "name", "descriptor",
	"country_code", "website", "description", "confidence_score", "source_url",
	"payload", "status", "first_seen_at", "last_seen_at", "banned_by", "banned_reason"
)
SELECT
	ss."id", ss."data_source_id",
	COALESCE(s."dedup_key", 'legacy:' || s."id"),
	ss."supplier_id", s."name", s."descriptor",
	s."country_code", s."website", s."description", s."confidence_score", s."source_ref",
	ss."payload", ss."status", ss."first_seen_at", ss."last_seen_at", ss."banned_by", ss."banned_reason"
FROM "supplier_source" ss
JOIN "supplier" s ON s."id" = ss."supplier_id";