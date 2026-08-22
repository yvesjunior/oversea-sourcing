// The connector contract (validated 2026-08-22, README → "Every source is an
// independent connector module").
//
// A connector does exactly one thing: WHEN ASKED, collect from its own source
// and return candidates in the one normalized format the platform understands.
// It never persists, never dedups, never sets provenance or confidence — the
// platform core applies those AFTER collection (src/server/research.ts), so no
// connector can corrupt the pool's integrity rules. Pull-only: a connector
// runs only when the pipeline or an admin refresh invokes it; if scheduled
// imports ever exist, the scheduler is just a third caller.
//
// Adding a source = one module implementing this interface + one row in
// `data_source` (registered in ./registry.ts). Nothing else changes.

import type { DataSourceType } from "@/database/schema";

/** What the request needs — the same brief for every connector. */
export type SearchBrief = {
  title: string;
  descriptionRaw: string;
  locale: string;
  criteria: Array<{ category: string; label: string; value: string; unit: string | null }>;
  /** Extracted text of the buyer's attachments, when any were readable. */
  attachmentText: string | null;
  /** Workspace country scope — null = worldwide. Connectors scope their
   *  collection to it; the matcher enforces it again as a hard filter. */
  countryCodes: string[] | null;
  /** How many candidates the caller wants (connectors may return fewer). */
  wanted: number;
};

/** The single normalized output shape — exactly what the persistence layer
 *  accepts. `raw` is kept verbatim as the source's own payload. */
export type SourceCandidate = {
  name: string;
  countryCode: string;
  website?: string | null;
  descriptor?: string | null;
  description?: string | null;
  /** 0-100 as reported by the source; the core clamps it (AI ceiling etc.). */
  confidence: number;
  /** Where the source saw this company (URL, registry entry id…). */
  sourceUrl?: string | null;
  /** The connector's raw payload, stored on the supplier_source membership. */
  raw?: Record<string, unknown>;
};

export type CollectResult = {
  candidates: SourceCandidate[];
  /** What the connector actually did (search queries, API calls) — audit trail. */
  queries: string[];
};

export interface SupplierSourceConnector {
  /** Self-description — lets /interne/sources render any connector unseen. */
  meta: {
    /** Must equal the `data_source.code` row that represents this connector. */
    code: string;
    type: DataSourceType;
    countryCode?: string;
    name: string;
  };
  /** The only entry point. Throws are fine — the caller isolates failures
   *  per source and records them on the run; one broken source never breaks
   *  the request. */
  collect(brief: SearchBrief): Promise<CollectResult>;
}
