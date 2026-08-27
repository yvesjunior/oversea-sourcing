CREATE TABLE "sanction_entry" (
	"id" text PRIMARY KEY NOT NULL,
	"list" text NOT NULL,
	"uid" text NOT NULL,
	"name" text NOT NULL,
	"name_slug" text NOT NULL,
	"program" text,
	"entity_type" text,
	"imported_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_verification" (
	"id" text PRIMARY KEY NOT NULL,
	"supplier_id" text NOT NULL,
	"check" text NOT NULL,
	"status" text NOT NULL,
	"source" text,
	"source_url" text,
	"result" jsonb,
	"checked_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "supplier_verification" ADD CONSTRAINT "supplier_verification_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sanction_entry_uq" ON "sanction_entry" USING btree ("list","uid");--> statement-breakpoint
CREATE INDEX "sanction_entry_slug_idx" ON "sanction_entry" USING btree ("name_slug");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_verification_uq" ON "supplier_verification" USING btree ("supplier_id","check");--> statement-breakpoint
CREATE INDEX "supplier_verification_supplier_idx" ON "supplier_verification" USING btree ("supplier_id");