ALTER TABLE "user" ADD COLUMN "account_type" text DEFAULT 'individual' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "company_name" text;--> statement-breakpoint
-- Organisation trial plan (owner decisions 2026-08-26): Free-like limits but
-- 3 seats — an organisation account exists to invite a team, so a 1-seat
-- trial would test nothing. Every value stays owner-editable on Abonnements.
INSERT INTO "plan" ("id", "code", "name", "requests_per_day", "max_requests_total", "max_members", "quota_scope", "audience", "suppliers_returned", "model_tier", "position")
VALUES ('plan-org-trial', 'org_trial', 'Essai Organisation', 1, 2, 3, 'workspace', 'organization', 5, 'cheap', 2)
ON CONFLICT DO NOTHING;
