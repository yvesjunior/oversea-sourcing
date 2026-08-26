-- India (MCA) catalogue source — autonomous full pull via data.gov.in
-- (requires DATA_GOV_IN_API_KEY, free signup). Seeded DISABLED like the
-- other registries; warm the store first, enabling is a staff decision.
INSERT INTO "data_source" ("id", "code", "name", "type", "country_code", "enabled")
VALUES ('ds-registry-in', 'registry-in', 'Registre des sociétés de l''Inde (MCA)', 'country_registry', 'IN', false)
ON CONFLICT ("code") DO NOTHING;
