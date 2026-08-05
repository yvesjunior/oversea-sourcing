CREATE SEQUENCE "public"."request_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 3000 CACHE 1;--> statement-breakpoint
CREATE TABLE "file" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"storage_key" text NOT NULL,
	"filename" text NOT NULL,
	"mime" text NOT NULL,
	"size" bigint NOT NULL,
	"uploaded_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_attachment" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"file_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_criterion" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"label" text NOT NULL,
	"value" text NOT NULL,
	"unit" text,
	"required" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'ai' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_event" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"type" text NOT NULL,
	"message" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "request_message" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "file" ADD CONSTRAINT "file_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "file" ADD CONSTRAINT "file_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_attachment" ADD CONSTRAINT "request_attachment_request_id_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_attachment" ADD CONSTRAINT "request_attachment_file_id_file_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."file"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_criterion" ADD CONSTRAINT "request_criterion_request_id_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_event" ADD CONSTRAINT "request_event_request_id_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_event" ADD CONSTRAINT "request_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_message" ADD CONSTRAINT "request_message_request_id_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "file_org_idx" ON "file" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "request_attachment_request_idx" ON "request_attachment" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "request_criterion_request_idx" ON "request_criterion" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "request_event_request_idx" ON "request_event" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "request_event_org_idx" ON "request_event" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "request_message_request_idx" ON "request_message" USING btree ("request_id");