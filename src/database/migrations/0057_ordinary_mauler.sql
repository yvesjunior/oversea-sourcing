ALTER TABLE "request" ADD COLUMN "validated_at" timestamp;--> statement-breakpoint
ALTER TABLE "request" ADD COLUMN "validated_by" text;--> statement-breakpoint
ALTER TABLE "request" ADD COLUMN "validated_by_name" text;--> statement-breakpoint
ALTER TABLE "request" ADD COLUMN "validated_spec_version" integer;--> statement-breakpoint
ALTER TABLE "request" ADD COLUMN "validated_profile_version" integer;--> statement-breakpoint
ALTER TABLE "request" ADD CONSTRAINT "request_validated_by_user_id_fk" FOREIGN KEY ("validated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;