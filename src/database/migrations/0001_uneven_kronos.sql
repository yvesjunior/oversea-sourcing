CREATE TABLE "request" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"created_by" text NOT NULL,
	"title" text NOT NULL,
	"description_raw" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"locale" text DEFAULT 'fr' NOT NULL,
	"compatibility_score" integer,
	"launched_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "request" ADD CONSTRAINT "request_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request" ADD CONSTRAINT "request_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "request_org_idx" ON "request" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "request_created_by_idx" ON "request" USING btree ("created_by");