ALTER TABLE "quote" ADD COLUMN "decline_reason" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "sent_by" text;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_sent_by_user_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;