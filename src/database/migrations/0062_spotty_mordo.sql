CREATE TABLE "partner_invitation" (
	"id" text PRIMARY KEY NOT NULL,
	"partner_id" text NOT NULL,
	"email" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"opened_at" timestamp,
	"registered_user_id" text,
	"registered_at" timestamp,
	"invited_by" text,
	"invited_by_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "partner_invitation" ADD CONSTRAINT "partner_invitation_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_invitation" ADD CONSTRAINT "partner_invitation_registered_user_id_user_id_fk" FOREIGN KEY ("registered_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_invitation" ADD CONSTRAINT "partner_invitation_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "partner_invitation_token_uq" ON "partner_invitation" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "partner_invitation_partner_idx" ON "partner_invitation" USING btree ("partner_id");