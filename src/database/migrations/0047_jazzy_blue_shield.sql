CREATE TABLE "supplier_contact" (
	"id" text PRIMARY KEY NOT NULL,
	"supplier_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"role" text,
	"phone" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"source" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_by" text,
	"created_by_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "source_record" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "supplier_contact" ADD CONSTRAINT "supplier_contact_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_contact" ADD CONSTRAINT "supplier_contact_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supplier_contact_supplier_idx" ON "supplier_contact" USING btree ("supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_contact_supplier_email_uq" ON "supplier_contact" USING btree ("supplier_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_contact_one_primary_uq" ON "supplier_contact" USING btree ("supplier_id") WHERE "supplier_contact"."is_primary";