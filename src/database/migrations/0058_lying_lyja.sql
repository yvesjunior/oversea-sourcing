CREATE TABLE "supplier_user" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"supplier_id" text NOT NULL,
	"created_via" text DEFAULT 'invitation' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "supplier_user" ADD CONSTRAINT "supplier_user_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_user" ADD CONSTRAINT "supplier_user_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_user_pair_uq" ON "supplier_user" USING btree ("user_id","supplier_id");--> statement-breakpoint
CREATE INDEX "supplier_user_supplier_idx" ON "supplier_user" USING btree ("supplier_id");