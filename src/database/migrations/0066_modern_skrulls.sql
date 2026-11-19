CREATE TABLE "deal_issue" (
	"id" text PRIMARY KEY NOT NULL,
	"deal_id" text NOT NULL,
	"kind" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"raised_by" text,
	"raised_by_name" text NOT NULL,
	"raised_by_role" text NOT NULL,
	"raised_by_party_id" text,
	"resolution" text,
	"resolved_by" text,
	"resolved_by_name" text,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deal_issue" ADD CONSTRAINT "deal_issue_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_issue" ADD CONSTRAINT "deal_issue_raised_by_user_id_fk" FOREIGN KEY ("raised_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_issue" ADD CONSTRAINT "deal_issue_raised_by_party_id_deal_party_id_fk" FOREIGN KEY ("raised_by_party_id") REFERENCES "public"."deal_party"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_issue" ADD CONSTRAINT "deal_issue_resolved_by_user_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deal_issue_deal_idx" ON "deal_issue" USING btree ("deal_id");