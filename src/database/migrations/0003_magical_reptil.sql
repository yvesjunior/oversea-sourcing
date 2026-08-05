CREATE TABLE "match" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"supplier_id" text NOT NULL,
	"rank" integer NOT NULL,
	"compatibility_score" integer NOT NULL,
	"confidence_score" integer NOT NULL,
	"risk_level" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'presented' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"descriptor" text,
	"country_code" text NOT NULL,
	"website" text,
	"description" text,
	"provenance" text DEFAULT 'imported' NOT NULL,
	"verification_status" text DEFAULT 'unverified' NOT NULL,
	"confidence_score" integer DEFAULT 50 NOT NULL,
	"risk_level" text DEFAULT 'medium' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "match" ADD CONSTRAINT "match_request_id_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match" ADD CONSTRAINT "match_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "match_request_idx" ON "match" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "match_request_supplier_uq" ON "match" USING btree ("request_id","supplier_id");