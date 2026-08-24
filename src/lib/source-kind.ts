// Two kinds of data source (decided 2026-08-24) — derivable from
// `data_source.type`, deliberately not a schema column:
//
// - DYNAMIC (`global_web`): the dataset does not exist until asked — a request
//   brief GENERATES candidates. Fed exclusively through requests via the
//   store-first fallback; never admin-triggered. Its store is a cache of past
//   request-driven collections.
// - STATIC (`country_registry`, `import`): the dataset exists independently of
//   any request. "Mettre à jour" = FULL PULL — the connector collects
//   everything its source has and the core saves it; idempotence comes from
//   dedup (supplier.dedup_key unique index + the uq(supplier, source)
//   membership upsert), so every trigger is a complete, duplicate-free sync.

import type { DataSourceType } from "@/database/schema";

export function isDynamicSource(type: DataSourceType): boolean {
  return type === "global_web";
}
