ALTER TABLE "request" ADD COLUMN "category_id" text;--> statement-breakpoint
CREATE INDEX "request_category_idx" ON "request" USING btree ("category_id");