CREATE TABLE "decision_pack_event" (
	"id" text PRIMARY KEY NOT NULL,
	"pack_id" text NOT NULL,
	"action" text NOT NULL,
	"actor_id" text,
	"actor_name" text,
	"payload" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "decision_pack_item" ALTER COLUMN "rank_shown" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "decision_pack" ADD COLUMN "assigned_to" text;--> statement-breakpoint
ALTER TABLE "decision_pack" ADD COLUMN "assigned_to_name" text;--> statement-breakpoint
ALTER TABLE "decision_pack" ADD COLUMN "released_at" timestamp;--> statement-breakpoint
ALTER TABLE "decision_pack" ADD COLUMN "released_by" text;--> statement-breakpoint
ALTER TABLE "decision_pack" ADD COLUMN "released_by_name" text;--> statement-breakpoint
ALTER TABLE "decision_pack" ADD COLUMN "refused_reason" text;--> statement-breakpoint
ALTER TABLE "request" ADD COLUMN "unfulfilled_reason" text;--> statement-breakpoint
ALTER TABLE "request" ADD COLUMN "unfulfilled_at" timestamp;--> statement-breakpoint
ALTER TABLE "request" ADD COLUMN "unfulfilled_by" text;--> statement-breakpoint
ALTER TABLE "request" ADD COLUMN "unfulfilled_by_name" text;--> statement-breakpoint
ALTER TABLE "decision_pack_event" ADD CONSTRAINT "decision_pack_event_pack_id_decision_pack_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."decision_pack"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_pack_event" ADD CONSTRAINT "decision_pack_event_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decision_pack_event_pack_idx" ON "decision_pack_event" USING btree ("pack_id","created_at");--> statement-breakpoint
ALTER TABLE "decision_pack" ADD CONSTRAINT "decision_pack_assigned_to_user_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_pack" ADD CONSTRAINT "decision_pack_released_by_user_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request" ADD CONSTRAINT "request_unfulfilled_by_user_id_fk" FOREIGN KEY ("unfulfilled_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;