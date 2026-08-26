-- Asian catalogue sources (investigated + built 2026-08-25), both seeded
-- DISABLED — warm the stores first, enabling for customers is a separate
-- staff decision.
-- registry-sg: AUTONOMOUS full pull (data.gov.sg open datastore, live
--   entities only, SSIC activity descriptions — matchable records).
-- registry-jp: FILE-FED (NTA download is a session-token form) — staff
--   uploads the 全件データ Unicode CSV ZIPs chunk by chunk; names only.
INSERT INTO "data_source" ("id", "code", "name", "type", "country_code", "enabled")
VALUES
	('ds-registry-sg', 'registry-sg', 'Registre des entités de Singapour (ACRA)', 'country_registry', 'SG', false),
	('ds-registry-jp', 'registry-jp', 'Registre des sociétés du Japon (NTA)', 'country_registry', 'JP', false)
ON CONFLICT ("code") DO NOTHING;
