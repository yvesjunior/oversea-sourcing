// Research orchestration (E4) — turns the AI gateway's candidates into rows in
// the platform-global supplier pool, and records what happened.
//
// This is the "enriches the database as a byproduct" half of the hybrid
// supplier strategy (doc/PLAN.md): every request that runs research grows the
// dataset, so repeat searches in the same category get cheaper over time.
//
// Deliberately failure-tolerant: research is an enrichment step, not a
// precondition. If the API is down, the key is missing, or the model returns
// nothing usable, the pipeline still ranks whatever pool already exists.

import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import { supplierDedupKey } from "@/lib/supplier-key";
import { recordEvent } from "@/server/requests";
import { readAttachmentsText } from "@/server/attachments";
import { parseCriteria } from "@/server/parse-criteria";
import { researchSuppliers, type SupplierCandidate } from "@/server/ai/research";

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

function cleanWebsite(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/** Candidate → insert values, or null when it isn't identifiable enough to keep. */
function toSupplierRow(candidate: SupplierCandidate, discoveredByRequestId: string) {
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
 * Run one research pass for a request: search, dedup, persist, record.
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

    const { candidates, queries } = await researchSuppliers({
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
    });

    // Dedup within the batch first (the model repeats itself across queries),
    // then let the unique index settle it against everything already stored.
    const rows = new Map<string, NonNullable<ReturnType<typeof toSupplierRow>>>();
    for (const candidate of candidates) {
      const row = toSupplierRow(candidate, requestId);
      if (row && !rows.has(row.dedupKey)) rows.set(row.dedupKey, row);
    }

    let added = 0;
    for (const row of rows.values()) {
      const inserted = await db
        .insert(schema.supplier)
        .values(row)
        .onConflictDoNothing({ target: schema.supplier.dedupKey })
        .returning({ id: schema.supplier.id });
      if (inserted.length > 0) added++;
    }

    await db
      .update(schema.researchRun)
      .set({
        status: "succeeded",
        queries,
        candidatesFound: candidates.length,
        suppliersAdded: added,
        completedAt: new Date(),
      })
      .where(eq(schema.researchRun.id, runId));

    await recordEvent(requestId, organizationId, "research.completed", {
      found: candidates.length,
      added,
    });
    console.log(
      `research: ${requestId} — ${queries.length} searches, ${candidates.length} candidates, ${added} new suppliers`,
    );
    return { found: candidates.length, added, skipped: null };
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
