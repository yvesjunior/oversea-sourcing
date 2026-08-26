// Connector #6: India's MCA company master data, via data.gov.in's open API
// (probed 2026-08-26: resource 4dbe5667 "Registrars of Companies (RoC)-wise
// Company Master Data", 3.67M rows, updated 2026-07, of which 2.6M Active —
// every record carries an NIC code + industrial-classification text, so the
// records are matchable).
//
// STATIC, AUTONOMOUS full pull — with one prerequisite: a personal
// data.gov.in API key in DATA_GOV_IN_API_KEY (free signup at data.gov.in;
// the public sample key caps responses at 10 rows and cannot page 2.6M).
// The run fails with a clear message when the key is missing.

import { NUMBERED_NAME } from "@/server/sources/csv";
import type { CollectResult, SearchBrief, SupplierSourceConnector } from "@/server/sources/types";

const RESOURCE_URL = "https://api.data.gov.in/resource/4dbe5667-7b6b-41d7-82af-211562424d9a";

/** Registry-attested existence WITH an NIC activity classification. */
const REGISTRY_IN_CONFIDENCE = 65;

/** Rows per page — registered keys accept large pages; the loop adapts to
 *  whatever the API actually returns, so a silent clamp only slows it. */
const PAGE_SIZE = Number(process.env["REGISTRY_IN_PAGE_SIZE"] ?? 1000);
/** Smoke-testing valve: stop after N pages (0 = full pull). */
const MAX_PAGES = Number(process.env["REGISTRY_IN_MAX_PAGES"] ?? 0);

const FETCH_ATTEMPTS = 4;
const FETCH_BACKOFF_MS = 1_500;
const FETCH_TIMEOUT_MS = 90_000;

type McaRecord = {
  CIN?: string;
  CompanyName?: string;
  CompanyStatus?: string;
  CompanyClass?: string;
  CompanyCategory?: string;
  CompanyStateCode?: string;
  CompanyRegistrationdate_date?: string;
  Registered_Office_Address?: string;
  nic_code?: string;
  CompanyIndustrialClassification?: string;
};

async function fetchJson(url: string): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (response.status === 429 || response.status >= 500) {
        throw new Error(`HTTP ${response.status}`);
      }
      if (!response.ok) {
        throw new Error(`registry-in: API call failed (HTTP ${response.status})`);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt === FETCH_ATTEMPTS - 1) break;
      const delay = FETCH_BACKOFF_MS * 2 ** attempt;
      console.warn(`registry-in: fetch retry ${attempt + 1}/${FETCH_ATTEMPTS - 1} in ${delay}ms`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

export const registryInConnector: SupplierSourceConnector = {
  meta: {
    code: "registry-in",
    type: "country_registry",
    countryCode: "IN",
    name: "Registre des sociétés de l'Inde (MCA)",
  },
  async collect(_brief: SearchBrief): Promise<CollectResult> {
    const apiKey = process.env["DATA_GOV_IN_API_KEY"]?.trim();
    if (!apiKey) {
      throw new Error(
        "registry-in: DATA_GOV_IN_API_KEY manquante — créez une clé gratuite sur data.gov.in " +
          "et ajoutez-la au .env (la clé d'exemple publique est plafonnée à 10 lignes)",
      );
    }

    const candidates: CollectResult["candidates"] = [];
    let skippedNumbered = 0;
    let offset = 0;
    let pages = 0;
    for (;;) {
      const page = (await fetchJson(
        `${RESOURCE_URL}?api-key=${encodeURIComponent(apiKey)}&format=json` +
          `&limit=${PAGE_SIZE}&offset=${offset}&filters%5BCompanyStatus%5D=Active`,
      )) as { total?: number; count?: number; records?: McaRecord[] };
      const records = page.records ?? [];
      for (const record of records) {
        const name = record.CompanyName?.trim() ?? "";
        if (!name) continue;
        if (NUMBERED_NAME.test(name)) {
          skippedNumbered++;
          continue;
        }
        const description = record.CompanyIndustrialClassification?.trim() || null;
        candidates.push({
          name,
          countryCode: "IN",
          website: null,
          descriptor: null,
          description,
          confidence: REGISTRY_IN_CONFIDENCE,
          sourceUrl: null,
          raw: {
            cin: record.CIN?.trim() ?? "",
            nic: record.nic_code?.trim() ?? "",
            state: record.CompanyStateCode?.trim() ?? "",
            class: record.CompanyClass?.trim() ?? "",
            registered: record.CompanyRegistrationdate_date?.trim() ?? "",
          },
        });
      }
      offset += records.length;
      pages++;
      if (pages % 50 === 0) {
        console.log(
          `registry-in: page ${pages} — running total ${candidates.length} of ~${page.total ?? "?"}`,
        );
      }
      const total = page.total ?? 0;
      if (records.length === 0 || offset >= total) break;
      if (MAX_PAGES > 0 && pages >= MAX_PAGES) {
        console.warn(`registry-in: stopping at MAX_PAGES=${MAX_PAGES} (smoke run)`);
        break;
      }
    }

    console.log(
      `registry-in: ${pages} pages — ${candidates.length} active companies kept, ` +
        `${skippedNumbered} numbered names skipped`,
    );
    return { candidates, queries: [`${RESOURCE_URL} (Active only, ${pages} pages)`] };
  },
};
