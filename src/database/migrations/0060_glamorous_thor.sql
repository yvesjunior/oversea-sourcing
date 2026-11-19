CREATE TABLE "partner" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"provider" text DEFAULT 'manual' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"notes" text,
	"created_by" text,
	"created_by_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_user" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"partner_id" text NOT NULL,
	"created_via" text DEFAULT 'invitation' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "partner" ADD CONSTRAINT "partner_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_user" ADD CONSTRAINT "partner_user_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_user" ADD CONSTRAINT "partner_user_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "partner_kind_idx" ON "partner" USING btree ("kind");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_user_pair_uq" ON "partner_user" USING btree ("user_id","partner_id");--> statement-breakpoint
CREATE INDEX "partner_user_partner_idx" ON "partner_user" USING btree ("partner_id");