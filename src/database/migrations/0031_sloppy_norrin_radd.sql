CREATE TABLE "platform_permission" (
	"feature" text NOT NULL,
	"role" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"updated_by" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "platform_permission_feature_role_pk" PRIMARY KEY("feature","role")
);

--> statement-breakpoint
-- Seed = the behavior hardcoded until 2026-08-28 (roles.ts + the ②j split).
-- The platform OWNER is deliberately absent: owner always has everything.
INSERT INTO "platform_permission" ("feature", "role", "enabled") VALUES
  ('facilitation',   'manager', true),
  ('verification',   'manager', true),
  ('finance',        'manager', false),
  ('analytics',      'manager', true),
  ('plans',          'manager', false),
  ('users',          'manager', true),
  ('clients',        'manager', true),
  ('sources',        'manager', true),
  ('logging',        'manager', true),
  ('sources.toggle', 'manager', false),
  ('sources.wipe',   'manager', false),
  ('logging.purge',  'manager', false),
  ('facilitation',   'accountant', false),
  ('verification',   'accountant', false),
  ('finance',        'accountant', true),
  ('analytics',      'accountant', true),
  ('plans',          'accountant', false),
  ('users',          'accountant', false),
  ('clients',        'accountant', false),
  ('sources',        'accountant', false),
  ('logging',        'accountant', false),
  ('sources.toggle', 'accountant', false),
  ('sources.wipe',   'accountant', false),
  ('logging.purge',  'accountant', false)
ON CONFLICT DO NOTHING;
