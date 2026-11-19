CREATE TABLE "kpi_profile" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"version" integer NOT NULL,
	"weights" jsonb NOT NULL,
	"source" text DEFAULT 'default' NOT NULL,
	"fingerprint" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_spec" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"version" integer NOT NULL,
	"content" jsonb NOT NULL,
	"fingerprint" text NOT NULL,
	"created_by" text,
	"created_by_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kpi_result" ADD COLUMN "spec_version" integer;--> statement-breakpoint
ALTER TABLE "kpi_result" ADD COLUMN "profile_version" integer;--> statement-breakpoint
ALTER TABLE "match" ADD COLUMN "spec_version" integer;--> statement-breakpoint
ALTER TABLE "match" ADD COLUMN "profile_version" integer;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "spec_version" integer;--> statement-breakpoint
ALTER TABLE "rfq_round" ADD COLUMN "spec_version" integer;--> statement-breakpoint
ALTER TABLE "kpi_profile" ADD CONSTRAINT "kpi_profile_request_id_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_spec" ADD CONSTRAINT "request_spec_request_id_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_spec" ADD CONSTRAINT "request_spec_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_profile_request_version_uq" ON "kpi_profile" USING btree ("request_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "request_spec_request_version_uq" ON "request_spec" USING btree ("request_id","version");