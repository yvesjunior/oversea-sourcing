CREATE TABLE "kpi_result" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"request_id" text NOT NULL,
	"round_id" text NOT NULL,
	"quote_id" text NOT NULL,
	"rank" integer NOT NULL,
	"score" integer NOT NULL,
	"breakdown" jsonb NOT NULL,
	"formula_version" text NOT NULL,
	"inputs_hash" text NOT NULL,
	"trigger" text NOT NULL,
	"computed_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "kpi_result" ADD CONSTRAINT "kpi_result_request_id_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_result" ADD CONSTRAINT "kpi_result_round_id_rfq_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rfq_round"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kpi_result" ADD CONSTRAINT "kpi_result_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_result_run_quote_uq" ON "kpi_result" USING btree ("run_id","quote_id");--> statement-breakpoint
CREATE INDEX "kpi_result_round_idx" ON "kpi_result" USING btree ("round_id","computed_at");--> statement-breakpoint
CREATE INDEX "kpi_result_request_idx" ON "kpi_result" USING btree ("request_id");