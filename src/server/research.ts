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

import { and, asc, eq, inArray } from "drizzle-orm";
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
import { getConnector } from "@/server/sources/registry";
import { eligibleSuppliers, resolveScope, type EffectiveScope } from "@/server/sources/scope";
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

/** Candidate → insert values, or null when it isn't identifiable enough to keep. */
function toSupplierRow(candidate: SourceCandidate, discoveredByRequestId: string | null) {
  const name = candidate.name.trim();
  const country = candidate.countryCode.trim().toUpperCase();
  const dedupKey = supplierDedupKey(name, country);
  if (!name || !dedupKey) return null;

  return {
    id: crypto.randomUUID(),
    name,
    descriptor: candidate.descriptor?.trim() || null,
    countryCode: country,
    website: cleanWebsite(candidate.website),
    description: candidate.description?.trim() || null,
    provenance: "ai_researched" as const,
    verificationStatus: "unverified" as const,
    confidenceScore: clampConfidence(candidate.confidence),
    riskLevel: "medium" as const,
    sourceRef: candidate.sourceUrl?.trim() || null,
    dedupKey,
    discoveredByRequestId,
    lastResearchedAt: new Date(),
  };
}

/**
 * Persist one source's candidates: dedup into the shared pool, then upsert
 * this source's store membership for every company encountered — a dedup hit
 * still refreshes `last_seen_at` and `last_researched_at`, because seeing the
 * company again is evidence it still exists. A banned membership is never
 * resurrected (the upsert only touches `active` rows), and a globally banned
 * supplier stays banned — the flag lives on the row the dedup key points to.
 */
async function persistFromSource(
  candidates: SourceCandidate[],
  requestId: string | null,
  dataSourceId: string,
): Promise<{ found: number; added: number; memberships: number }> {
  // Dedup within the batch first (a source can repeat itself across queries),
  // then let the unique index settle it against everything already stored.
  const rows = new Map<
    string,
    { row: NonNullable<ReturnType<typeof toSupplierRow>>; raw: Record<string, unknown> | undefined }
  >();
  for (const candidate of candidates) {
    const row = toSupplierRow(candidate, requestId);
    if (row && !rows.has(row.dedupKey)) rows.set(row.dedupKey, { row, raw: candidate.raw });
  }

  let added = 0;
  let memberships = 0;
  for (const { row, raw } of rows.values()) {
    const inserted = await db
      .insert(schema.supplier)
      .values(row)
      .onConflictDoNothing({ target: schema.supplier.dedupKey })
      .returning({ id: schema.supplier.id });

    let supplierId = inserted[0]?.id;
    if (supplierId) {
      added++;
    } else {
      const existing = await db.query.supplier.findFirst({
        where: eq(schema.supplier.dedupKey, row.dedupKey),
        columns: { id: true },
      });
      if (!existing) continue; // raced with a delete — nothing to attach to
      supplierId = existing.id;
      await db
        .update(schema.supplier)
        .set({ lastResearchedAt: new Date() })
        .where(eq(schema.supplier.id, supplierId));
    }

    await db
      .insert(schema.supplierSource)
      .values({
        id: crypto.randomUUID(),
        supplierId,
        dataSourceId,
        status: "active",
        payload: raw ?? null,
      })
      .onConflictDoUpdate({
        target: [schema.supplierSource.supplierId, schema.supplierSource.dataSourceId],
        set: { lastSeenAt: new Date() },
        // Never resurrect a per-source ban: the refresh only touches active rows.
        setWhere: eq(schema.supplierSource.status, "active"),
      });
    memberships++;
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

type SupplierRow = typeof schema.supplier.$inferSelect;
type CriterionRow = typeof schema.requestCriterion.$inferSelect;

/**
 * Pure half of the store-first decision — how many of these suppliers qualify
 * as a store answer for these criteria? A candidate must be fresh
 * (≤ STORE_FRESH_DAYS), confident (≥ STORE_MIN_CONFIDENCE) and actually match
 * (score ≥ STORE_MIN_SCORE). Exported for unit tests (A7).
 */
export function countQualifyingCandidates(
  pool: SupplierRow[],
  criteria: CriterionRow[],
  now: Date = new Date(),
): number {
  const freshCutoff = new Date(now.getTime() - STORE_FRESH_DAYS * 24 * 60 * 60 * 1000);
  return pool.filter((supplier) => {
    if (!supplier.lastResearchedAt || supplier.lastResearchedAt < freshCutoff) return false;
    if (supplier.confidenceScore < STORE_MIN_CONFIDENCE) return false;
    return scoreSupplier(supplier, criteria).total >= STORE_MIN_SCORE;
  }).length;
}

export type StoreCoverage = {
  /** Store answer is good enough — skip live collection entirely. */
  sufficient: boolean;
  /** Candidates that passed the freshness + score + confidence bars. */
  qualifying: number;
  /** Eligible pool size within scope (any freshness). */
  poolSize: number;
  /** Supplier ids the matcher may rank for this workspace (hard filter). */
  eligibleIds: string[];
  scope: EffectiveScope;
};

/**
 * The store-first decision (validated 2026-08-22): score the eligible pool
 * against the request's criteria and decide whether live collection is needed.
 * "Insufficient" means too few candidates, match too low, or confidence too
 * low — thresholds in sourcing-config (A8 draft numbers, env-overridable).
 */
export async function evaluateStoreCoverage(
  requestId: string,
  organizationId: string,
): Promise<StoreCoverage> {
  const scope = await resolveScope(organizationId);
  const [pool, criteria] = await Promise.all([
    eligibleSuppliers(scope),
    db.query.requestCriterion.findMany({
      where: eq(schema.requestCriterion.requestId, requestId),
      orderBy: [asc(schema.requestCriterion.position)],
    }),
  ]);

  const qualifying = countQualifyingCandidates(pool, criteria);

  return {
    sufficient: qualifying >= STORE_MIN_CANDIDATES,
    qualifying,
    poolSize: pool.length,
    eligibleIds: pool.map((s) => s.id),
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
      const connector = getConnector(source.code);
      // Store-only source (registries, imports): its store IS its answer —
      // nothing to collect at request time.
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
        const persisted = await persistFromSource(result.candidates, requestId, source.id);
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
