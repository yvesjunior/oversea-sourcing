CREATE TABLE "rfq_round" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"round_no" integer NOT NULL,
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"closes_at" timestamp NOT NULL,
	"window_hours" integer NOT NULL,
	"target_offers" integer NOT NULL,
	"opened_by" text,
	"opened_by_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mail_outbox" ADD COLUMN "reply_to" text;--> statement-breakpoint
ALTER TABLE "quote" ADD COLUMN "round_id" text;--> statement-breakpoint
ALTER TABLE "rfq_round" ADD CONSTRAINT "rfq_round_request_id_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rfq_round" ADD CONSTRAINT "rfq_round_opened_by_user_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rfq_round_request_no_uq" ON "rfq_round" USING btree ("request_id","round_no");--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_round_id_rfq_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rfq_round"("id") ON DELETE set null ON UPDATE no action;