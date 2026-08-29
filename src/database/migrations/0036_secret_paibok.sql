CREATE TABLE "translation_memory" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"source_lang" text NOT NULL,
	"target_lang" text NOT NULL,
	"translated" text NOT NULL,
	"hits" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "request_criterion" ADD COLUMN "value_en" text;--> statement-breakpoint
CREATE UNIQUE INDEX "translation_memory_uq" ON "translation_memory" USING btree ("source","source_lang","target_lang");