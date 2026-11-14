ALTER TABLE "rfq_round" ADD COLUMN "closed_at" timestamp;--> statement-breakpoint
ALTER TABLE "rfq_round" ADD COLUMN "close_reason" text;--> statement-breakpoint
ALTER TABLE "rfq_round" ADD COLUMN "closed_by" text;--> statement-breakpoint
ALTER TABLE "rfq_round" ADD COLUMN "closed_by_name" text;--> statement-breakpoint
ALTER TABLE "rfq_round" ADD COLUMN "early_note" text;--> statement-breakpoint
ALTER TABLE "rfq_round" ADD CONSTRAINT "rfq_round_closed_by_user_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;