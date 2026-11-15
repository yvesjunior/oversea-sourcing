CREATE TABLE "decision_pack" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"round_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"release_mode" text NOT NULL,
	"kpi_run_id" text,
	"built_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decision_pack_item" (
	"id" text PRIMARY KEY NOT NULL,
	"pack_id" text NOT NULL,
	"quote_id" text,
	"kpi_result_id" text,
	"rank_computed" integer NOT NULL,
	"rank_shown" integer NOT NULL,
	"offer" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "decision_pack" ADD CONSTRAINT "decision_pack_request_id_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_pack" ADD CONSTRAINT "decision_pack_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_pack" ADD CONSTRAINT "decision_pack_round_id_rfq_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rfq_round"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_pack_item" ADD CONSTRAINT "decision_pack_item_pack_id_decision_pack_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."decision_pack"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_pack_item" ADD CONSTRAINT "decision_pack_item_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_pack_item" ADD CONSTRAINT "decision_pack_item_kpi_result_id_kpi_result_id_fk" FOREIGN KEY ("kpi_result_id") REFERENCES "public"."kpi_result"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decision_pack_request_idx" ON "decision_pack" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "decision_pack_org_idx" ON "decision_pack" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_pack_one_pending_uq" ON "decision_pack" USING btree ("request_id") WHERE "decision_pack"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "decision_pack_item_pack_idx" ON "decision_pack_item" USING btree ("pack_id");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_pack_item_pack_quote_uq" ON "decision_pack_item" USING btree ("pack_id","quote_id");