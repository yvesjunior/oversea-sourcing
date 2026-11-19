CREATE TABLE "order_milestone" (
	"id" text PRIMARY KEY NOT NULL,
	"deal_id" text NOT NULL,
	"kind" text NOT NULL,
	"planned_at" timestamp,
	"completed_at" timestamp,
	"note" text,
	"channel" text DEFAULT 'staff' NOT NULL,
	"updated_by" text,
	"updated_by_name" text,
	"updated_by_role" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "milestone_id" text;--> statement-breakpoint
ALTER TABLE "order_milestone" ADD CONSTRAINT "order_milestone_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_milestone" ADD CONSTRAINT "order_milestone_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "order_milestone_deal_kind_uq" ON "order_milestone" USING btree ("deal_id","kind");--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_milestone_id_order_milestone_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."order_milestone"("id") ON DELETE set null ON UPDATE no action;