// Research orchestration (E4) — the platform core around the source connectors.
//
// Store-first (validated 2026-08-22): every source answers from its own store
// (supplier_source memberships); live collection is the FALLBACK, invoked only
// when the store's answer is insufficient — too few candidates, match too low,
// or confidence too low — and only for sources that have a registered
// connector (today: global_web). evaluateStoreCoverage() is that decision;
// the pipeline worker calls it before ever enqueueing research.
//
// This module — never a connector — owns persistence: dedup (the unique index
// on supplier.dedup_key), provenance, confidence clamping, memberships and the
// source_run audit. A connector only turns a brief into candidates.
//
// Deliberately failure-tolerant: research is an enrichment step, not a
// precondition. One broken source degrades that source's contribution; the
// pipeline still ranks whatever the stores already hold.

import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import { supplierDedupKey } from "@/lib/supplier-key";
import { recordEvent } from "@/server/requests";
import { readAttachmentsText } from "@/server/attachments";
import { parseCriteria } from "@/server/parse-criteria";
import { scoreSupplier } from "@/server/matching";
import {
  STORE_FRESH_DAYS,
  STORE_MIN_CANDIDATES,
  STORE_MIN_CONFIDENCE,
  STORE_MIN_SCORE,
  RESEARCH_CANDIDATE_CAP,
} from "@/server/sourcing-config";
import { isDynamicSource } from "@/lib/source-kind";
import { getConnector } from "@/server/sources/registry";
import {
  eligibleCandidates,
  resolveScope,
  type EffectiveScope,
  type MatchCandidate,
} from "@/server/sources/scope";
import type { SearchBrief, SourceCandidate } from "@/server/sources/types";

export type ResearchOutcome = {
  found: number;
  added: number;
  skipped: "already_ran" | null;
};

/** AI-found suppliers are unverified by construction — cap their confidence so
 *  a confident-sounding model can never outrank an OSI-verified company. */
const AI_CONFIDENCE_CEILING = 70;

function clampConfidence(raw: number): number {
  if (!Number.isFinite(raw)) return 50;
  // Models answer the "0-100" instruction on a 0-1 scale often enough that
  // trusting the prompt here silently floors every AI supplier at the minimum.
  // Anything ≤ 1 is a probability, not a percentage.
  const percent = raw > 0 && raw <= 1 ? raw * 100 : raw;
  return Math.max(10, Math.min(AI_CONFIDENCE_CEILING, Math.round(percent)));
}

function cleanWebsite(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** Candidate → store-record insert values, or null when it isn't
 *  identifiable enough to keep. */
function toRecordRow(candidate: SourceCandidate, dataSourceId: string) {
  const name = candidate.name.trim();
  const country = candidate.countryCode.trim().toUpperCase();
  const dedupKey = supplierDedupKey(name, country);
  if (!name || !dedupKey) return null;

  return {
    id: crypto.randomUUID(),
    dataSourceId,
    dedupKey,
    name,
    descriptor: candidate.descriptor?.trim() || null,
    countryCode: country,
    website: cleanWebsite(candidate.website),
    description: candidate.description?.trim() || null,
    confidenceScore: clampConfidence(candidate.confidence),
    sourceUrl: candidate.sourceUrl?.trim() || null,
    payload: candidate.raw ?? null,
  };
}

/**
 * Persist one source's collection into its STORE (Phase D): records only,
 * never suppliers — a supplier row is created at promotion (Top-N ranking in
 * the matcher). A re-encounter refreshes `last_seen_at` (evidence the company
 * still exists) and, when the record is already promoted, the supplier's
 * `last_researched_at` too. A banned record is never resurrected (the upsert
 * only touches `active` rows) — sticky across re-collection by construction.
 */
async function persistFromSource(
  candidates: SourceCandidate[],
  dataSourceId: string,
): Promise<{ found: number; added: number; memberships: number }> {
  // Dedup within the batch first (a source can repeat itself across queries),
  // then let the unique index settle it against everything already stored.
  const rows = new Map<string, NonNullable<ReturnType<typeof toRecordRow>>>();
  for (const candidate of candidates) {
    const row = toRecordRow(candidate, dataSourceId);
    if (row && !rows.has(row.dedupKey)) rows.set(row.dedupKey, row);
  }

  // Chunked upserts: a static full pull can carry hundreds of thousands of
  // rows (registry-ca: ~640k) — row-by-row would take hours. One multi-row
  // upsert per chunk; `xmax = 0` distinguishes a fresh insert from a
  // refreshed row. The setWhere keeps bans sticky: a banned record is never
  // touched, so a fresh pull cannot resurrect it.
  const PERSIST_CHUNK = 500;
  const all = [...rows.values()];
  let added = 0;
  let memberships = 0;
  const now = new Date();
  for (let i = 0; i < all.length; i += PERSIST_CHUNK) {
    const chunk = all.slice(i, i + PERSIST_CHUNK);
    const upserted = await db
      .insert(schema.sourceRecord)
      .values(chunk)
      .onConflictDoUpdate({
        target: [schema.sourceRecord.dataSourceId, schema.sourceRecord.dedupKey],
        set: { lastSeenAt: now, payload: sql`excluded.payload` },
        setWhere: eq(schema.sourceRecord.status, "active"),
      })
      .returning({ created: sql<boolean>`(xmax = 0)` });
    memberships += upserted.length;
    added += upserted.filter((r) => r.created).length;
  }

  // Re-encountering a promoted company proves it still exists — refresh its
  // supplier's freshness in bulk (only keys from THIS batch, so a small
  // request-driven collection never over-touches unrelated suppliers).
  const keys = all.map((row) => row.dedupKey);
  const TOUCH_CHUNK = 5_000;
  for (let i = 0; i < keys.length; i += TOUCH_CHUNK) {
    const slice = keys.slice(i, i + TOUCH_CHUNK);
    const promoted = db
      .select({ id: schema.sourceRecord.supplierId })
      .from(schema.sourceRecord)
      .where(
        and(
          eq(schema.sourceRecord.dataSourceId, dataSourceId),
          inArray(schema.sourceRecord.dedupKey, slice),
          isNotNull(schema.sourceRecord.supplierId),
        ),
      );
    await db
      .update(schema.supplier)
      .set({ lastResearchedAt: now })
      .where(inArray(schema.supplier.id, promoted));
  }
  return { found: candidates.length, added, memberships };
}

/** Normalized digest of what a request is asking for — same need, same
 *  fingerprint, however it was worded. Stored on research_run. */
export function requestFingerprint(
  criteria: Array<{ category: string; value: string }>,
  countryCodes: string[] | null,
): string {
  const parts = criteria
    .map((c) => `${c.category}:${c.value.trim().toLowerCase()}`)
    .sort()
    .join("|");
  const scope = countryCodes ? [...countryCodes].sort().join(",") : "global";
  return `${scope}::${parts}`;
}

type CriterionRow = typeof schema.requestCriterion.$inferSelect;

/**
 * Pure half of the store-first decision — how many of these candidates
 * qualify as a store answer for these criteria? A candidate must be fresh
 * (≤ STORE_FRESH_DAYS on `lastSeenAt`), confident (≥ STORE_MIN_CONFIDENCE)
 * and actually match (score ≥ STORE_MIN_SCORE). Exported for unit tests (A7).
 */
export function countQualifyingCandidates(
  pool: MatchCandidate[],
  criteria: CriterionRow[],
  now: Date = new Date(),
): number {
  const freshCutoff = new Date(now.getTime() - STORE_FRESH_DAYS * 24 * 60 * 60 * 1000);
  return pool.filter((candidate) => {
    if (!candidate.lastSeenAt || candidate.lastSeenAt < freshCutoff) return false;
    if (candidate.confidenceScore < STORE_MIN_CONFIDENCE) return false;
    return scoreSupplier(candidate, criteria).total >= STORE_MIN_SCORE;
  }).length;
}

export type StoreCoverage = {
  /** Store answer is good enough — skip live collection entirely. */
  sufficient: boolean;
  /** Candidates that passed the freshness + score + confidence bars. */
  qualifying: number;
  /** Eligible pool size within scope (any freshness). */
  poolSize: number;
  /** The logical candidates the matcher may rank (hard scope filter applied). */
  candidates: MatchCandidate[];
  scope: EffectiveScope;
};

/**
 * The store-first decision (validated 2026-08-22): score the eligible
 * candidates against the request's criteria and decide whether live
 * collection is needed. "Insufficient" means too few candidates, match too
 * low, or confidence too low — thresholds in sourcing-config (A8 draft
 * numbers, env-overridable).
 */
export async function evaluateStoreCoverage(
  requestId: string,
  organizationId: string,
): Promise<StoreCoverage> {
  const [scope, criteria] = await Promise.all([
    resolveScope(organizationId),
    db.query.requestCriterion.findMany({
      where: eq(schema.requestCriterion.requestId, requestId),
      orderBy: [asc(schema.requestCriterion.position)],
    }),
  ]);
  // Criteria feed the big-store SQL prefilter (C2b).
  const pool = await eligibleCandidates(
    scope,
    criteria.map((c) => c.value),
  );

  const qualifying = countQualifyingCandidates(pool, criteria);

  return {
    sufficient: qualifying >= STORE_MIN_CANDIDATES,
    qualifying,
    poolSize: pool.length,
    candidates: pool,
    scope,
  };
}

/**
 * Parse the attachment text with the same intake regexes used on the typed
 * description, and add whatever the description did not already cover.
 *
 * Same parser on purpose: a criterion found in a PDF should be indistinguishable
 * from one typed into the box, editable in the same UI, feeding the same matcher.
 */
async function addCriteriaFromAttachments(
  requestId: string,
  organizationId: string,
  attachmentText: string,
  locale: string,
): Promise<void> {
  const existing = await db.query.requestCriterion.findMany({
    where: eq(schema.requestCriterion.requestId, requestId),
  });
  const seen = new Set(
    existing.map((c) => `${c.category}|${c.label.toLowerCase()}|${c.value.toLowerCase()}`),
  );
  const nextPosition = existing.reduce((max, c) => Math.max(max, c.position), -1) + 1;

  const parsed = parseCriteria(attachmentText, locale).filter((c) => {
    const key = `${c.category}|${c.label.toLowerCase()}|${c.value.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (parsed.length === 0) return;

  await db.insert(schema.requestCriterion).values(
    parsed.map((criterion, index) => ({
      id: crypto.randomUUID(),
      requestId,
      category: criterion.category,
      label: criterion.label,
      value: criterion.value,
      unit: criterion.unit,
      required: criterion.required,
      source: "ai" as const,
      position: nextPosition + index,
    })),
  );
  await recordEvent(requestId, organizationId, "criteria.fromAttachment", {
    count: parsed.length,
  });
}

/**
 * Run one collection pass for a request across its effective sources: for each
 * source with a registered connector, collect → persist → audit (source_run).
 * Sources fail independently — one broken connector never breaks the request.
 *
 * Idempotent by design — a request that already has a run is skipped. The
 * worker's recovery sweep re-adopts anything sitting in `searching` for more
 * than two minutes, and a long research pass can cross that line; without this
 * guard the sweep would pay for the same searches twice.
 */
export async function runResearchForRequest(
  requestId: string,
  organizationId: string,
): Promise<ResearchOutcome> {
  const previous = await db.query.researchRun.findFirst({
    where: and(
      eq(schema.researchRun.requestId, requestId),
      inArray(schema.researchRun.status, ["running", "succeeded"]),
    ),
  });
  if (previous) {
    console.log(`research: ${requestId} already has a ${previous.status} run — skipping`);
    return { found: 0, added: 0, skipped: "already_ran" };
  }

  const request = await db.query.request.findFirst({
    where: eq(schema.request.id, requestId),
  });
  if (!request) throw new Error(`Request ${requestId} not found`);

  const runId = crypto.randomUUID();
  await db.insert(schema.researchRun).values({ id: runId, requestId, status: "running" });
  await recordEvent(requestId, organizationId, "research.started");

  try {
    // Read what the buyer attached BEFORE searching: a spec sheet usually
    // carries the real requirements, and criteria found in it should reach both
    // the dossier and the search brief.
    const attachments = await readAttachmentsText(requestId);
    if (attachments.read.length > 0 || attachments.skipped.length > 0) {
      console.log(
        `research: ${requestId} attachments read=[${attachments.read.join(", ")}]` +
          (attachments.skipped.length > 0
            ? ` skipped=[${attachments.skipped.map((s) => `${s.filename}: ${s.reason}`).join("; ")}]`
            : ""),
      );
    }
    if (attachments.text) {
      await addCriteriaFromAttachments(requestId, organizationId, attachments.text, request.locale);
    }

    const criteria = await db.query.requestCriterion.findMany({
      where: eq(schema.requestCriterion.requestId, requestId),
      orderBy: [asc(schema.requestCriterion.position)],
    });

    const scope = await resolveScope(organizationId);
    await db
      .update(schema.researchRun)
      .set({ fingerprint: requestFingerprint(criteria, scope.countryCodes) })
      .where(eq(schema.researchRun.id, runId));

    const brief: SearchBrief = {
      title: request.title,
      descriptionRaw: request.descriptionRaw,
      locale: request.locale,
      criteria: criteria.map((c) => ({
        category: c.category,
        label: c.label,
        value: c.value,
        unit: c.unit,
      })),
      attachmentText: attachments.text,
      countryCodes: scope.countryCodes,
      wanted: RESEARCH_CANDIDATE_CAP,
    };

    let found = 0;
    let added = 0;
    const allQueries: string[] = [];
    for (const source of scope.sources) {
      // STATIC sources never collect at request time (two-kinds rule,
      // 2026-08-24): their store IS their answer, refreshed only by the
      // admin full pull. Having a registered connector (registry-ca does)
      // must not opt them into the fallback — a buyer request cannot be
      // the thing that downloads a 100 MB registry file.
      if (!isDynamicSource(source.type)) continue;
      const connector = getConnector(source.code);
      if (!connector) continue;

      const sourceRunId = crypto.randomUUID();
      await db.insert(schema.sourceRun).values({
        id: sourceRunId,
        dataSourceId: source.id,
        trigger: "request",
        requestId,
      });
      try {
        const result = await connector.collect(brief);
        const persisted = await persistFromSource(result.candidates, source.id);
        found += persisted.found;
        added += persisted.added;
        allQueries.push(...result.queries);
        await db
          .update(schema.sourceRun)
          .set({
            status: "succeeded",
            candidatesFound: persisted.found,
            suppliersAdded: persisted.added,
            membershipsUpserted: persisted.memberships,
            completedAt: new Date(),
          })
          .where(eq(schema.sourceRun.id, sourceRunId));
      } catch (error) {
        // One broken source degrades its contribution, never the request.
        const message = error instanceof Error ? error.message : String(error);
        console.error(`research: ${requestId} source ${source.code} FAILED —`, error);
        await db
          .update(schema.sourceRun)
          .set({ status: "failed", error: message.slice(0, 500), completedAt: new Date() })
          .where(eq(schema.sourceRun.id, sourceRunId));
      }
    }

    await db
      .update(schema.researchRun)
      .set({
        status: "succeeded",
        queries: allQueries,
        candidatesFound: found,
        suppliersAdded: added,
        completedAt: new Date(),
      })
      .where(eq(schema.researchRun.id, runId));

    await recordEvent(requestId, organizationId, "research.completed", { found, added });
    console.log(
      `research: ${requestId} — ${allQueries.length} queries across ${scope.sources.length} source(s), ${found} candidates, ${added} new suppliers`,
    );
    return { found, added, skipped: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(schema.researchRun)
      .set({ status: "failed", error: message.slice(0, 500), completedAt: new Date() })
      .where(eq(schema.researchRun.id, runId));
    await recordEvent(requestId, organizationId, "research.failed");
    console.error(`research: ${requestId} FAILED —`, error);
    // Swallowed on purpose: the pipeline continues and ranks the existing pool.
    return { found: 0, added: 0, skipped: null };
  }
}

/**
 * Admin "Mettre à jour" (C1, semantics settled 2026-08-24) — STATIC sources
 * only, and always a FULL PULL: the connector collects everything its source
 * has, the core saves it, and idempotence comes from dedup (the dedup_key
 * unique index + the membership upsert), so every trigger is a complete,
 * duplicate-free sync. Dynamic sources (global_web) are never admin-triggered
 * — they are fed exclusively through requests via the store-first fallback.
 *
 * The server fn already created the source_run row (trigger=admin,
 * status=running) so the screen shows it immediately; this — running on the
 * research queue — does the collection and settles the row.
 */
export async function runAdminRefresh(sourceRunId: string): Promise<void> {
  const run = await db.query.sourceRun.findFirst({
    where: eq(schema.sourceRun.id, sourceRunId),
  });
  if (!run) throw new Error(`source_run ${sourceRunId} not found`);
  // Idempotence: a retried/duplicate job must not pay for the pull twice.
  if (run.status !== "running") {
    console.log(`refresh: ${sourceRunId} already ${run.status} — skipping`);
    return;
  }

  const source = await db.query.dataSource.findFirst({
    where: eq(schema.dataSource.id, run.dataSourceId),
  });
  const fail = async (error: string) => {
    await db
      .update(schema.sourceRun)
      .set({ status: "failed", error, completedAt: new Date() })
      .where(eq(schema.sourceRun.id, sourceRunId));
  };
  if (!source) return fail("data_source introuvable");
  const { isDynamicSource } = await import("@/lib/source-kind");
  if (isDynamicSource(source.type)) {
    return fail("source dynamique — alimentée par les demandes, jamais par déclenchement admin");
  }
  const connector = getConnector(source.code);
  if (!connector) return fail("source sans connecteur (store-only)");

  // A full pull needs no scope — the brief is a formality static connectors
  // ignore beyond the source's own country. File-fed sources (registry-qc)
  // read the staff upload through brief.fileKey.
  const fileKey =
    typeof (run.scope as Record<string, unknown> | null)?.["fileKey"] === "string"
      ? ((run.scope as Record<string, unknown>)["fileKey"] as string)
      : null;
  const brief: SearchBrief = {
    title: source.name,
    descriptionRaw: `Synchronisation complète de la source ${source.code}.`,
    locale: "fr",
    criteria: [],
    attachmentText: null,
    countryCodes: source.countryCode ? [source.countryCode] : null,
    wanted: Number.MAX_SAFE_INTEGER,
    fileKey,
  };

  try {
    const result = await connector.collect(brief);
    const persisted = await persistFromSource(result.candidates, source.id);
    await db
      .update(schema.sourceRun)
      .set({
        status: "succeeded",
        candidatesFound: persisted.found,
        suppliersAdded: persisted.added,
        membershipsUpserted: persisted.memberships,
        completedAt: new Date(),
      })
      .where(eq(schema.sourceRun.id, sourceRunId));
    console.log(
      `refresh: ${source.code} full pull — ${persisted.found} records, ` +
        `${persisted.added} new, ${persisted.memberships} memberships`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`refresh: ${source.code} FAILED —`, error);
    await fail(message.slice(0, 500));
  } finally {
    // Staff uploads are consumed by the run — never left on the volume.
    if (fileKey) {
      const { deleteFile } = await import("@/server/storage");
      await deleteFile(fileKey);
    }
  }
}
