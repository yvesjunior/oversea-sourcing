ALTER TABLE "organization" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "archived_by" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "archived_by_name" text;