// The cahier des charges and the KPI profile (Phase V · V19) — the rows.
//
// Two versioned, immutable records per request:
//
//   request_spec   what a supplier is asked to quote against
//   kpi_profile    the weights both scorers rank with
//
// The pure halves are `src/lib/request-spec.ts` and `src/lib/kpi-profile.ts`.
// This file decides WHEN a version is written, and that is one rule:
//
//   build both from what the request holds now; write a new version of each
//   only if its fingerprint differs from the latest one.
//
// So calling `ensureSpec` is always safe and usually writes nothing. It is
// called where a version is about to be RELIED on — the launch, a ranking, an
// RFQ leaving — and, through `refreshSpecIfAny`, wherever the criteria change
// once a spec exists. A draft has no spec until it is launched: its criteria
// are still being written (V18), and a version per keystroke would bury the
// one that mattered.

import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import { defaultProfile, profileFingerprint, type KpiProfileWeights } from "@/lib/kpi-profile";
import { buildSpecContent, specFingerprint, type SpecContent } from "@/lib/request-spec";
import { recordEvent, type Executor } from "@/server/requests";

/** Whose change made a version. Null = the system. */
export type SpecActor = { id: string; name: string } | null;

type SpecRow = typeof schema.requestSpec.$inferSelect;
type ProfileRow = typeof schema.kpiProfile.$inferSelect;

export async function latestSpec(
  requestId: string,
  executor: Executor = db,
): Promise<SpecRow | null> {
  const [row] = await executor
    .select()
    .from(schema.requestSpec)
    .where(eq(schema.requestSpec.requestId, requestId))
    .orderBy(desc(schema.requestSpec.version))
    .limit(1);
  return row ?? null;
}

export async function latestProfile(
  requestId: string,
  executor: Executor = db,
): Promise<ProfileRow | null> {
  const [row] = await executor
    .select()
    .from(schema.kpiProfile)
    .where(eq(schema.kpiProfile.requestId, requestId))
    .orderBy(desc(schema.kpiProfile.version))
    .limit(1);
  return row ?? null;
}

export type EnsuredSpec = {
  specVersion: number;
  profileVersion: number;
  content: SpecContent;
  weights: KpiProfileWeights;
  /** Whether THIS call wrote a new version of each. */
  wrote: { spec: boolean; profile: boolean };
};

async function ensureIn(tx: Executor, requestId: string, actor: SpecActor): Promise<EnsuredSpec> {
  // Two callers at once (a criteria edit and the worker reaching the ranking)
  // would both read version N and both write N+1. One at a time per request.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"request-spec:" + requestId}))`);

  const [request] = await tx
    .select({
      organizationId: schema.request.organizationId,
      title: schema.request.title,
      descriptionRaw: schema.request.descriptionRaw,
      categoryId: schema.request.categoryId,
      locale: schema.request.locale,
    })
    .from(schema.request)
    .where(eq(schema.request.id, requestId));
  if (!request) throw new Error(`ensureSpec: request ${requestId} not found`);

  // One after the other, not `Promise.all`: these share the transaction's
  // single connection, which runs one query at a time.
  const criteria = await tx
    .select()
    .from(schema.requestCriterion)
    .where(eq(schema.requestCriterion.requestId, requestId));
  const attachments = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.requestAttachment)
    .where(eq(schema.requestAttachment.requestId, requestId));
  const spec = await latestSpec(requestId, tx);
  const profile = await latestProfile(requestId, tx);

  // ── the specification ─────────────────────────────────────────────────────
  const content = buildSpecContent({
    locale: request.locale,
    title: request.title,
    categoryId: request.categoryId,
    description: request.descriptionRaw,
    criteria,
    attachments: attachments[0]?.count ?? 0,
  });
  const fingerprint = specFingerprint(content);
  let specVersion = spec?.version ?? 0;
  let specContent = spec?.content ?? content;
  const specChanged = !spec || spec.fingerprint !== fingerprint;
  if (specChanged) {
    specVersion += 1;
    specContent = content;
    await tx.insert(schema.requestSpec).values({
      id: crypto.randomUUID(),
      requestId,
      version: specVersion,
      content,
      fingerprint,
      createdBy: actor?.id ?? null,
      createdByName: actor?.name ?? null,
    });
    await recordEvent(
      requestId,
      request.organizationId,
      "spec.versioned",
      { version: specVersion },
      tx,
    );
  }

  // ── the profile ───────────────────────────────────────────────────────────
  // A profile the buyer validated is theirs: the platform does not replace it
  // with its own proposal because a criterion moved. (Nothing writes a
  // `buyer` profile before V20; a criterion it does not name is weighed by
  // the profile's own required / optional fallback.)
  let profileVersion = profile?.version ?? 0;
  let weights = profile?.weights ?? defaultProfile(criteria);
  let profileChanged = false;
  if (!profile || profile.source === "default") {
    const proposed = defaultProfile(criteria);
    const proposedPrint = profileFingerprint(proposed);
    if (!profile || profile.fingerprint !== proposedPrint) {
      profileChanged = true;
      profileVersion += 1;
      weights = proposed;
      await tx.insert(schema.kpiProfile).values({
        id: crypto.randomUUID(),
        requestId,
        version: profileVersion,
        weights: proposed,
        source: "default",
        fingerprint: proposedPrint,
      });
    }
  }

  return {
    specVersion,
    profileVersion,
    content: specContent,
    weights,
    wrote: { spec: specChanged, profile: profileChanged },
  };
}

/**
 * Make sure the latest spec and profile say what the request says now, and
 * return them. Writes a new version of either only when it changed.
 *
 * Pass the caller's transaction when there is one, so the version and what
 * relies on it (an RFQ round, a ranking) commit together.
 */
export async function ensureSpec(
  requestId: string,
  actor: SpecActor = null,
  executor: Executor = db,
): Promise<EnsuredSpec> {
  if (executor !== db) return ensureIn(executor, requestId, actor);
  // The advisory lock is transaction-scoped: on the bare pool it would be
  // released the instant it was taken.
  return db.transaction((tx) => ensureIn(tx, requestId, actor));
}

/**
 * The criteria just changed: write the next version — IF the request has a
 * spec at all. A draft does not, and stays without one until it is launched.
 */
export async function refreshSpecIfAny(
  requestId: string,
  actor: SpecActor = null,
  executor: Executor = db,
): Promise<void> {
  if (!(await latestSpec(requestId, executor))) return;
  await ensureSpec(requestId, actor, executor);
}

/**
 * The specification a request WOULD have now, without writing anything — for
 * read paths (the RFQ preview before a round exists). Prefers a stored
 * version; builds one in memory only when the request has none yet.
 */
export async function specForReading(
  requestId: string,
  version?: number | null,
): Promise<SpecContent | null> {
  const stored = await readSpec(requestId, version ?? undefined);
  if (stored) return stored.content;
  const latest = version ? await latestSpec(requestId) : null;
  if (latest) return latest.content;
  const request = await db.query.request.findFirst({ where: eq(schema.request.id, requestId) });
  if (!request) return null;
  const [criteria, attachments] = await Promise.all([
    db.query.requestCriterion.findMany({
      where: eq(schema.requestCriterion.requestId, requestId),
    }),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.requestAttachment)
      .where(eq(schema.requestAttachment.requestId, requestId)),
  ]);
  return buildSpecContent({
    locale: request.locale,
    title: request.title,
    categoryId: request.categoryId,
    description: request.descriptionRaw,
    criteria,
    attachments: attachments[0]?.count ?? 0,
  });
}

/** One version, or the latest when none is asked for. */
export async function readSpec(requestId: string, version?: number): Promise<SpecRow | null> {
  if (version === undefined) return latestSpec(requestId);
  const rows = await db
    .select()
    .from(schema.requestSpec)
    .where(eq(schema.requestSpec.requestId, requestId));
  return rows.find((row) => row.version === version) ?? null;
}

/** Every version of a request's spec, newest first — who and when, no content. */
export async function specVersions(
  requestId: string,
): Promise<Array<{ version: number; createdAt: Date; createdByName: string | null }>> {
  return db
    .select({
      version: schema.requestSpec.version,
      createdAt: schema.requestSpec.createdAt,
      createdByName: schema.requestSpec.createdByName,
    })
    .from(schema.requestSpec)
    .where(eq(schema.requestSpec.requestId, requestId))
    .orderBy(desc(schema.requestSpec.version));
}
