-- Second catalogue source: the Canadian federal corporations registry
-- (Corporations Canada bulk open data, OGL — C2 investigation, README §9).
-- Static, store-only at request time; its store fills through the admin
-- "Mettre à jour" full pull. Seeded DISABLED on purpose: warming the store
-- is allowed while disabled (C1 decision), and enabling it puts ~600k
-- name-only records in every default workspace's matching scope — that is a
-- product decision plus a matcher-scale check, not a default.
INSERT INTO "data_source" ("id", "code", "name", "type", "country_code", "enabled")
VALUES (
	'ds-registry-ca',
	'registry-ca',
	'Registre fédéral canadien (Corporations Canada)',
	'country_registry',
	'CA',
	false
)
ON CONFLICT ("code") DO NOTHING;
