-- Third catalogue source: the Quebec enterprise registry (Registraire des
-- entreprises). Static, FILE-FED: the endpoint cannot be fetched
-- autonomously, so staff uploads the ZIP on /interne/sources and the full
-- pull parses it. Seeded DISABLED like registry-ca — enabling for customers
-- is a separate staff decision once the store is warmed.
INSERT INTO "data_source" ("id", "code", "name", "type", "country_code", "enabled")
VALUES (
	'ds-registry-qc',
	'registry-qc',
	'Registre des entreprises du Québec',
	'country_registry',
	'CA',
	false
)
ON CONFLICT ("code") DO NOTHING;
