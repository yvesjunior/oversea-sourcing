// Connector #4: Singapore's ACRA corporate-entities registry, via
// data.gov.sg's open datastore (no key, no account — probed 2026-08-25).
//
// STATIC, AUTONOMOUS full pull: the "ACRA Information on Corporate Entities"
// collection is 27 datasets (A–Z + others, refreshed monthly upstream). The
// connector resolves the child-dataset ids from the collection metadata at
// run time, then pages each datastore with a server-side filter on LIVE
// statuses (1000 rows/page — the API's cap). Every record carries its
// primary SSIC activity code + description, so — like registry-qc, unlike
// registry-ca — these records are genuinely matchable.

import { NUMBERED_NAME } from "@/server/sources/csv";
import type { CollectResult, SearchBrief, SupplierSourceConnector } from "@/server/sources/types";

const COLLECTION_META_URL =
  "https://api-production.data.gov.sg/v2/public/api/collections/2/metadata";
const DATASTORE_URL = "https://data.gov.sg/api/action/datastore_search";

/** The API rejects larger pages ("Size of row data too large"). */
const PAGE_SIZE = 1000;

/** Registry-attested existence WITH a declared SSIC activity. */
const REGISTRY_SG_CONFIDENCE = 65;

/** Server-side status filter — only entities currently on the register.
 *  Values not present in a dataset are simply unmatched, so the list can be
 *  generous across entity types. */
const LIVE_STATUSES = ["Live", "Live Company", "Registered"];

type AcraRecord = {
  uen?: string;
  entity_name?: string;
  entity_type_description?: string;
  entity_status_description?: string;
  registration_incorporation_date?: string;
  primary_ssic_code?: string;
  primary_ssic_description?: string;
  primary_user_described_activity?: string;
  secondary_ssic_description?: string;
  street_name?: string;
  postal_code?: string;
};

/** A full pull is ~600 sequential calls — transient network blips and the
 *  odd 429/5xx are a certainty at that count, so every call retries with
 *  backoff instead of sinking the whole run. */
const FETCH_ATTEMPTS = 4;
const FETCH_BACKOFF_MS = 1_500;
const FETCH_TIMEOUT_MS = 60_000;

async function fetchJson(url: string): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (response.status === 429 || response.status >= 500) {
        throw new Error(`HTTP ${response.status}`);
      }
      if (!response.ok) {
        throw new Error(`registry-sg: ${url.slice(0, 80)}… failed (HTTP ${response.status})`);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt === FETCH_ATTEMPTS - 1) break;
      const delay = FETCH_BACKOFF_MS * 2 ** attempt;
      console.warn(`registry-sg: fetch retry ${attempt + 1}/${FETCH_ATTEMPTS - 1} in ${delay}ms`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

/** "na" is ACRA's explicit not-available marker — treat it as empty. */
function value(raw: string | undefined): string {
  const trimmed = raw?.trim() ?? "";
  return trimmed.toLowerCase() === "na" ? "" : trimmed;
}

export const registrySgConnector: SupplierSourceConnector = {
  meta: {
    code: "registry-sg",
    type: "country_registry",
    countryCode: "SG",
    name: "Registre des entités de Singapour (ACRA)",
  },
  async collect(_brief: SearchBrief): Promise<CollectResult> {
    const meta = (await fetchJson(COLLECTION_META_URL)) as {
      data?: { collectionMetadata?: { childDatasets?: string[] } };
    };
    const datasetIds = meta.data?.collectionMetadata?.childDatasets ?? [];
    if (datasetIds.length === 0) {
      throw new Error("registry-sg: collection metadata returned no datasets");
    }

    const filters = encodeURIComponent(
      JSON.stringify({ entity_status_description: LIVE_STATUSES }),
    );
    // Select only the columns we map — full rows carry 50+ fields (15 former
    // names, audit firms…) and would multiply the transfer by ~10.
    const fields = encodeURIComponent(
      [
        "uen",
        "entity_name",
        "entity_type_description",
        "entity_status_description",
        "registration_incorporation_date",
        "primary_ssic_code",
        "primary_ssic_description",
        "primary_user_described_activity",
        "secondary_ssic_description",
        "street_name",
        "postal_code",
      ].join(","),
    );
    const candidates: CollectResult["candidates"] = [];
    let skippedNumbered = 0;
    let datasetIndex = 0;

    for (const datasetId of datasetIds) {
      datasetIndex++;
      const before = candidates.length;
      let offset = 0;
      for (;;) {
        const page = (await fetchJson(
          `${DATASTORE_URL}?resource_id=${datasetId}&limit=${PAGE_SIZE}&offset=${offset}&filters=${filters}&fields=${fields}`,
        )) as { result?: { total?: number; records?: AcraRecord[] } };
        const records = page.result?.records ?? [];
        for (const record of records) {
          const name = value(record.entity_name);
          if (!name) continue;
          if (NUMBERED_NAME.test(name)) {
            skippedNumbered++;
            continue;
          }
          const description = [
            value(record.primary_ssic_description),
            value(record.secondary_ssic_description),
            value(record.primary_user_described_activity),
          ]
            .filter(Boolean)
            .join(" · ");
          candidates.push({
            name,
            countryCode: "SG",
            website: null,
            descriptor: null,
            description: description ? description.slice(0, 400) : null,
            confidence: REGISTRY_SG_CONFIDENCE,
            sourceUrl: null,
            raw: {
              uen: value(record.uen),
              type: value(record.entity_type_description),
              ssic: value(record.primary_ssic_code),
              registered: value(record.registration_incorporation_date),
              street: value(record.street_name),
              postal: value(record.postal_code),
            },
          });
        }
        offset += records.length;
        const total = page.result?.total ?? 0;
        if (records.length === 0 || offset >= total) break;
      }
      console.log(
        `registry-sg: dataset ${datasetIndex}/${datasetIds.length} — ` +
          `${candidates.length - before} live entities (running total ${candidates.length})`,
      );
    }

    console.log(
      `registry-sg: ${datasetIds.length} datasets paged — ` +
        `${candidates.length} live entities kept, ${skippedNumbered} numbered names skipped`,
    );
    return { candidates, queries: [`${DATASTORE_URL} (${datasetIds.length} datasets, live only)`] };
  },
};
