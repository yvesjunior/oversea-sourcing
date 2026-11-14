ALTER TABLE "quote" ADD COLUMN "channel" text;--> statement-breakpoint
-- Every answer on record so far was typed in by staff: the supplier portal
-- does not exist yet. A quote with no answer keeps a null channel.
UPDATE "quote" SET "channel" = 'staff' WHERE "responded_at" IS NOT NULL;
