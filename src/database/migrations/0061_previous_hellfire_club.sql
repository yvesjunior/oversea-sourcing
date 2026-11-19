CREATE TABLE "partner_case" (
	"id" text PRIMARY KEY NOT NULL,
	"partner_id" text NOT NULL,
	"quote_id" text NOT NULL,
	"request_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"brief" text,
	"external_ref" text,
	"opened_by" text,
	"opened_by_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_enrichment" (
	"id" text PRIMARY KEY NOT NULL,
	"case_id" text NOT NULL,
	"quote_id" text NOT NULL,
	"kind" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" text NOT NULL,
	"details" jsonb,
	"valid_until" timestamp,
	"channel" text DEFAULT 'staff' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text,
	"created_by_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "partner_case" ADD CONSTRAINT "partner_case_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_case" ADD CONSTRAINT "partner_case_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_case" ADD CONSTRAINT "partner_case_request_id_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_case" ADD CONSTRAINT "partner_case_opened_by_user_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_enrichment" ADD CONSTRAINT "partner_enrichment_case_id_partner_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."partner_case"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_enrichment" ADD CONSTRAINT "partner_enrichment_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_enrichment" ADD CONSTRAINT "partner_enrichment_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "partner_case_quote_idx" ON "partner_case" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "partner_case_partner_idx" ON "partner_case" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "partner_case_request_idx" ON "partner_case" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "partner_enrichment_quote_idx" ON "partner_enrichment" USING btree ("quote_id");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_enrichment_case_version_uq" ON "partner_enrichment" USING btree ("case_id","version");