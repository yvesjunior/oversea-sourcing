CREATE SEQUENCE "public"."contract_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
CREATE TABLE "contract" (
	"id" text PRIMARY KEY NOT NULL,
	"number" text NOT NULL,
	"deal_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"amount_cents" bigint,
	"currency" text,
	"incoterm" text,
	"payment_terms" text,
	"due_at" timestamp,
	"sent_at" timestamp,
	"signed_at" timestamp,
	"voided_at" timestamp,
	"voided_reason" text,
	"created_by" text,
	"created_by_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_event" (
	"id" text PRIMARY KEY NOT NULL,
	"contract_id" text NOT NULL,
	"type" text NOT NULL,
	"actor_id" text,
	"actor_name" text,
	"party_id" text,
	"party_name" text,
	"detail" jsonb,
	"at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contract_party" (
	"id" text PRIMARY KEY NOT NULL,
	"contract_id" text NOT NULL,
	"role" text NOT NULL,
	"user_id" text,
	"organization_id" text,
	"supplier_id" text,
	"name" text NOT NULL,
	"email" text,
	"required" boolean DEFAULT true NOT NULL,
	"signature_status" text DEFAULT 'pending' NOT NULL,
	"method" text,
	"signed_at" timestamp,
	"signed_by_name" text,
	"signed_file_id" text,
	"evidence" jsonb,
	"reminded_at" timestamp,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"request_id" text,
	"quote_id" text,
	"supplier_id" text,
	"supplier_name" text NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"amount_cents" bigint,
	"currency" text,
	"incoterm" text,
	"opened_at" timestamp DEFAULT now() NOT NULL,
	"satisfaction" integer,
	"review_comment" text,
	"reviewed_at" timestamp,
	"reviewed_by" text,
	"reviewed_by_name" text,
	"closed_at" timestamp,
	"closed_by" text,
	"closed_by_name" text,
	"created_by" text,
	"created_by_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_event" (
	"id" text PRIMARY KEY NOT NULL,
	"deal_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"type" text NOT NULL,
	"message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"supplier_id" text,
	"supplier_name" text NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"amount_cents" bigint,
	"currency" text,
	"quantity" text,
	"moq" text,
	"lead_time_days" integer,
	"incoterm" text,
	"payment_terms" text,
	"valid_until" timestamp,
	"notes" text,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"requested_by" text,
	"responded_at" timestamp,
	"recorded_by" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract" ADD CONSTRAINT "contract_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_event" ADD CONSTRAINT "contract_event_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_party" ADD CONSTRAINT "contract_party_contract_id_contract_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contract"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_party" ADD CONSTRAINT "contract_party_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_party" ADD CONSTRAINT "contract_party_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_party" ADD CONSTRAINT "contract_party_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_party" ADD CONSTRAINT "contract_party_signed_file_id_file_id_fk" FOREIGN KEY ("signed_file_id") REFERENCES "public"."file"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_request_id_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."request"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_quote_id_quote_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quote"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_closed_by_user_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_event" ADD CONSTRAINT "deal_event_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_event" ADD CONSTRAINT "deal_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_request_id_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote" ADD CONSTRAINT "quote_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contract_number_uq" ON "contract" USING btree ("number");--> statement-breakpoint
CREATE INDEX "contract_deal_idx" ON "contract" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "contract_org_idx" ON "contract" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "contract_event_contract_idx" ON "contract_event" USING btree ("contract_id","at");--> statement-breakpoint
CREATE INDEX "contract_party_contract_idx" ON "contract_party" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "deal_org_idx" ON "deal" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "deal_request_idx" ON "deal" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "deal_event_deal_idx" ON "deal_event" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "quote_request_idx" ON "quote" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "quote_org_idx" ON "quote" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "quote_supplier_idx" ON "quote" USING btree ("supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quote_request_supplier_uq" ON "quote" USING btree ("request_id","supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quote_one_accepted_per_request_uq" ON "quote" USING btree ("request_id") WHERE "quote"."status" = 'accepted';