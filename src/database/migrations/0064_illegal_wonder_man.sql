CREATE TABLE "deal_party" (
	"id" text PRIMARY KEY NOT NULL,
	"deal_id" text NOT NULL,
	"role" text NOT NULL,
	"organization_id" text,
	"supplier_id" text,
	"partner_id" text,
	"name" text NOT NULL,
	"added_by" text,
	"added_by_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message" (
	"id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"author_id" text,
	"author_name" text NOT NULL,
	"author_role" text NOT NULL,
	"author_party_id" text,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_thread" (
	"id" text PRIMARY KEY NOT NULL,
	"deal_id" text NOT NULL,
	"subject" text NOT NULL,
	"parties" jsonb NOT NULL,
	"created_by" text,
	"created_by_name" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_message_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deal" ADD COLUMN "buyer_disclosed_at" timestamp;--> statement-breakpoint
ALTER TABLE "deal" ADD COLUMN "buyer_disclosed_by_name" text;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "deal_id" text;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "shared_with" jsonb;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "supersedes_id" text;--> statement-breakpoint
ALTER TABLE "document" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "deal_party" ADD CONSTRAINT "deal_party_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_party" ADD CONSTRAINT "deal_party_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_party" ADD CONSTRAINT "deal_party_supplier_id_supplier_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_party" ADD CONSTRAINT "deal_party_partner_id_partner_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partner"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_party" ADD CONSTRAINT "deal_party_added_by_user_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_thread_id_message_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."message_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_author_party_id_deal_party_id_fk" FOREIGN KEY ("author_party_id") REFERENCES "public"."deal_party"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_thread" ADD CONSTRAINT "message_thread_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_thread" ADD CONSTRAINT "message_thread_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "deal_party_deal_idx" ON "deal_party" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "deal_party_supplier_idx" ON "deal_party" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "deal_party_partner_idx" ON "deal_party" USING btree ("partner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deal_party_partner_uq" ON "deal_party" USING btree ("deal_id","partner_id") WHERE "deal_party"."partner_id" is not null;--> statement-breakpoint
CREATE INDEX "message_by_thread_idx" ON "message" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "message_thread_deal_idx" ON "message_thread" USING btree ("deal_id");--> statement-breakpoint
ALTER TABLE "document" ADD CONSTRAINT "document_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_deal_idx" ON "document" USING btree ("deal_id");