ALTER TABLE "plan" ADD COLUMN "quotes_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Soumissions are a PAID feature (owner, 2026-09-14): Pro for an individual
-- account, Business or Enterprise for an organisation; the trial plans
-- (free, org_trial) only allow requests. The internal plan keeps everything.
-- Rows, not code: the owner moves this line from Abonnements afterwards.
UPDATE "plan" SET "quotes_enabled" = true WHERE "code" IN ('pro', 'business', 'enterprise', 'internal');
