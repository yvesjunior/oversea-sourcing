CREATE TABLE "criterion_proposal" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"message_id" text NOT NULL,
	"op" text NOT NULL,
	"criterion_id" text,
	"category" text DEFAULT 'other' NOT NULL,
	"label" text NOT NULL,
	"value" text NOT NULL,
	"unit" text,
	"required" boolean DEFAULT false NOT NULL,
	"previous" text,
	"previous_required" boolean,
	"status" text DEFAULT 'pending' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"resolved_at" timestamp,
	"resolved_by" text,
	"resolved_by_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "request_message" ADD COLUMN "questions" jsonb;--> statement-breakpoint
ALTER TABLE "criterion_proposal" ADD CONSTRAINT "criterion_proposal_request_id_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "criterion_proposal" ADD CONSTRAINT "criterion_proposal_message_id_request_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."request_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "criterion_proposal" ADD CONSTRAINT "criterion_proposal_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "criterion_proposal_request_idx" ON "criterion_proposal" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "criterion_proposal_message_idx" ON "criterion_proposal" USING btree ("message_id");