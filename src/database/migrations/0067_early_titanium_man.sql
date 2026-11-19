CREATE TABLE "supplier_performance" (
	"id" text PRIMARY KEY NOT NULL,
	"supplier_id" text,
	"supplier_name" text NOT NULL,
	"deal_id" text,
	"response_hours" integer,
	"supplier_steps_planned" integer DEFAULT 0 NOT NULL,
	"supplier_steps_late" integer DEFAULT 0 NOT NULL,
	"delivered_late" boolean,
	"satisfaction" integer,
	"issues_raised" integer DEFAULT 0 NOT NULL,
	"issues_resolved" integer DEFAULT 0 NOT NULL,
	"issues_disputed" integer DEFAULT 0 NOT NULL,
	"closed_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "supplier_performance" ADD CONSTRAINT "supplier_performance_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_performance" ADD CONSTRAINT "supplier_performance_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supplier_performance_supplier_idx" ON "supplier_performance" USING btree ("supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "supplier_performance_deal_uq" ON "supplier_performance" USING btree ("deal_id");