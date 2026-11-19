CREATE TABLE "rfq_invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"quote_id" text NOT NULL,
	"contact_id" text,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"opened_at" timestamp,
	"registered_user_id" text,
	"registered_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rfq_invitation" ADD CONSTRAINT "rfq_invitation_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_invitation" ADD CONSTRAINT "rfq_invitation_contact_id_supplier_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."supplier_contact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_invitation" ADD CONSTRAINT "rfq_invitation_registered_user_id_user_id_fk" FOREIGN KEY ("registered_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rfq_invitation_token_uq" ON "rfq_invitation" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "rfq_invitation_quote_idx" ON "rfq_invitation" USING btree ("quote_id");