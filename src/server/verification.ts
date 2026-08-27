// The verification battery (ADR-001 §4 = E10) — runs in worker-research
// right after a request's Top-N is promoted: every presented supplier gets
// the free checks, each writing one evidence row (supplier_verification),
// and the trust tier / verification_status is derived from the rows
// (src/lib/verification.ts). THIS MODULE IS THE ONLY WRITER of
// supplier.verification_status.
//
// v1 checks (free — owner constraint 2026-08-26: no paid data
// subscriptions, EVER):
//   existence        → the verification-role registry STORES, offline lookup
//   digital_identity → website reachable · MX present · domain age (RDAP)
//   sanctions        → OFAC SDN screened locally (list refreshed ≤7 days)
// export_record is dormant (no free customs route); certification joins
// with a free cert-registry route; human_review is a staff action (E10).

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import type { VerificationCheck, VerificationOutcome } from "@/database/schema";
import { nameSlug } from "@/lib/supplier-key";
import {
  AUTO_CHECKS,
  CHECK_TTL_DAYS,
  deriveVerificationStatus,
  type AutoCheck,
} from "@/lib/verification";
import { CsvParser } from "@/server/sources/csv";

const OFAC_SDN_URL = "https://www.treasury.gov/ofac/downloads/sdn.csv";
const SANCTIONS_MAX_AGE_DAYS = 7;
const SITE_TIMEOUT_MS = 8_000;
const RDAP_TIMEOUT_MS = 8_000;

type SupplierRow = typeof schema.supplier.$inferSelect;

type CheckResult = {
  status: VerificationOutcome;
  source?: string;
  sourceUrl?: string;
  result?: Record<string, unknown>;
};

// ── existence — offline lookup against the verification-role stores ─────────

async function checkExistence(supplier: SupplierRow): Promise<CheckResult> {
  if (!supplier.dedupKey) return { status: "inconclusive", result: { reason: "no_dedup_key" } };

  const verificationSources = await db
    .select({ id: schema.dataSource.id, code: schema.dataSource.code })
    .from(schema.dataSource)
    .where(
      and(
        eq(schema.dataSource.role, "verification"),
        eq(schema.dataSource.countryCode, supplier.countryCode.toUpperCase()),
      ),
    );
  if (verificationSources.length === 0) {
    // No registry backend covers this country (China, Vietnam…) — the tier
    // must come from other evidence, not punish the supplier for our gap.
    return { status: "inconclusive", result: { reason: "country_not_covered" } };
  }

  const ids = verificationSources.map((s) => s.id);
  const hit = await db.query.sourceRecord.findFirst({
    where: and(
      inArray(schema.sourceRecord.dataSourceId, ids),
      eq(schema.sourceRecord.dedupKey, supplier.dedupKey),
      eq(schema.sourceRecord.status, "active"),
    ),
  });
  if (!hit) {
    // Covered country, no record: could be a store older than the company or
    // a name-form mismatch — a red flag worth surfacing, not a conviction.
    return {
      status: "failed",
      result: { reason: "not_in_registry", searched: verificationSources.map((s) => s.code) },
    };
  }
  const code = verificationSources.find((s) => s.id === hit.dataSourceId)?.code ?? "registry";
  return {
    status: "passed",
    source: code,
    ...(hit.sourceUrl ? { sourceUrl: hit.sourceUrl } : {}),
    result: {
      registryName: hit.name,
      snapshotAt: hit.lastSeenAt.toISOString(),
      ...(hit.description ? { activity: hit.description.slice(0, 200) } : {}),
    },
  };
}

// ── digital identity — site alive · MX · domain age ─────────────────────────

function domainOf(website: string): string | null {
  try {
    return new URL(website.startsWith("http") ? website : `https://${website}`).hostname;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(url: string, ms: number, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal, redirect: "follow" });
  } finally {
    clearTimeout(timer);
  }
}

async function checkDigitalIdentity(supplier: SupplierRow): Promise<CheckResult> {
  if (!supplier.website) return { status: "inconclusive", result: { reason: "no_website" } };
  const domain = domainOf(supplier.website);
  if (!domain) return { status: "inconclusive", result: { reason: "unparseable_website" } };

  const result: Record<string, unknown> = { domain };

  let siteAlive = false;
  try {
    const response = await fetchWithTimeout(`https://${domain}`, SITE_TIMEOUT_MS);
    siteAlive = response.status < 500;
    result["siteStatus"] = response.status;
  } catch {
    try {
      const response = await fetchWithTimeout(supplier.website, SITE_TIMEOUT_MS);
      siteAlive = response.status < 500;
      result["siteStatus"] = response.status;
    } catch (error) {
      result["siteError"] = error instanceof Error ? error.name : "fetch_failed";
    }
  }

  try {
    const { resolveMx } = await import("node:dns/promises");
    const mx = await resolveMx(domain);
    result["mx"] = mx.length > 0;
  } catch {
    result["mx"] = false;
  }

  // Domain age via the RDAP bootstrap redirector — free, no key. A young
  // domain is recorded as a flag, never an automatic failure.
  try {
    const response = await fetchWithTimeout(`https://rdap.org/domain/${domain}`, RDAP_TIMEOUT_MS, {
      headers: { accept: "application/rdap+json" },
    });
    if (response.ok) {
      const body = (await response.json()) as {
        events?: Array<{ eventAction?: string; eventDate?: string }>;
      };
      const registered = body.events?.find((e) => e.eventAction === "registration")?.eventDate;
      if (registered) {
        result["domainRegisteredAt"] = registered;
        const ageDays = (Date.now() - new Date(registered).getTime()) / 86_400_000;
        if (ageDays < 90) result["youngDomain"] = true;
      }
    }
  } catch {
    // RDAP coverage is uneven (many ccTLDs) — absence is not evidence.
  }

  return { status: siteAlive ? "passed" : "failed", source: "web", result };
}

// ── sanctions — OFAC SDN, screened locally ──────────────────────────────────

/** Re-download the SDN list when the local copy is stale. Failure-tolerant:
 *  a download error keeps the previous list (screening stays possible). */
export async function ensureSanctionsFresh(): Promise<void> {
  const [latest] = await db
    .select({ newest: sql<Date | null>`max(${schema.sanctionEntry.importedAt})` })
    .from(schema.sanctionEntry);
  const newest = latest?.newest ? new Date(latest.newest) : null;
  if (newest && Date.now() - newest.getTime() < SANCTIONS_MAX_AGE_DAYS * 86_400_000) return;

  let rows: Array<{ uid: string; name: string; entityType: string | null; program: string | null }>;
  try {
    const response = await fetchWithTimeout(OFAC_SDN_URL, 60_000);
    if (!response.ok) throw new Error(`SDN download HTTP ${response.status}`);
    const text = await response.text();
    rows = [];
    // SDN.CSV columns: ent_num, SDN_Name, SDN_Type, Program, … ("-0-" = null).
    const parser = new CsvParser((row) => {
      const [uid, name, type, program] = row;
      if (!uid || !name || !/^\d+$/.test(uid.trim())) return;
      rows.push({
        uid: uid.trim(),
        name: name.trim(),
        entityType: type && type.trim() !== "-0-" ? type.trim() : null,
        program: program && program.trim() !== "-0-" ? program.trim() : null,
      });
    });
    parser.write(text);
    parser.end();
    if (rows.length < 1000) throw new Error(`SDN list suspiciously small (${rows.length} rows)`);
  } catch (error) {
    console.error("verification: OFAC SDN refresh failed — keeping the previous list", error);
    return;
  }

  await db.transaction(async (tx) => {
    await tx.delete(schema.sanctionEntry).where(eq(schema.sanctionEntry.list, "ofac_sdn"));
    const values = rows.flatMap((row) => {
      const slug = nameSlug(row.name);
      if (!slug) return [];
      return [
        {
          id: crypto.randomUUID(),
          list: "ofac_sdn",
          uid: row.uid,
          name: row.name,
          nameSlug: slug,
          program: row.program,
          entityType: row.entityType,
        },
      ];
    });
    for (let i = 0; i < values.length; i += 2000) {
      await tx.insert(schema.sanctionEntry).values(values.slice(i, i + 2000));
    }
  });
  console.log(`verification: OFAC SDN refreshed — ${rows.length} entries`);
}

async function checkSanctions(supplier: SupplierRow): Promise<CheckResult> {
  const slug = nameSlug(supplier.name);
  if (!slug) return { status: "inconclusive", result: { reason: "no_name_slug" } };

  // Deliberately conservative: whole-slug equality only. Token-subset matching
  // over a 15k-name list floods staff with false positives; a real screening
  // vendor can replace this seam later.
  const hits = await db.query.sanctionEntry.findMany({
    where: eq(schema.sanctionEntry.nameSlug, slug),
    limit: 5,
  });
  if (hits.length === 0) return { status: "passed", source: "ofac_sdn" };
  return {
    status: "failed",
    source: "ofac_sdn",
    result: {
      matches: hits.map((h) => ({ uid: h.uid, name: h.name, program: h.program })),
    },
  };
}

// ── orchestration ────────────────────────────────────────────────────────────

const RUNNERS: Record<AutoCheck, (supplier: SupplierRow) => Promise<CheckResult>> = {
  existence: checkExistence,
  digital_identity: checkDigitalIdentity,
  sanctions: checkSanctions,
};

/** Re-derive a supplier's verification_status from its evidence rows and
 *  persist it. Part of the single-writer contract of this module. */
export async function persistDerivedStatus(supplierId: string): Promise<void> {
  const evidence = await db.query.supplierVerification.findMany({
    where: eq(schema.supplierVerification.supplierId, supplierId),
    columns: { check: true, status: true },
  });
  const status = deriveVerificationStatus(evidence);
  await db
    .update(schema.supplier)
    .set({ verificationStatus: status })
    .where(eq(schema.supplier.id, supplierId));
}

/** The E10 staff decision — the ONLY way a supplier reaches Tier 3
 *  ("Vérifié OSI"). Approve writes the human_review evidence row (who,
 *  when, note); revoke deletes it — the tier falls back to whatever the
 *  automated evidence supports, exactly like any other expired evidence. */
export async function recordHumanReview(
  supplierId: string,
  reviewer: { id: string; name: string },
  action: "approve" | "revoke",
  note?: string,
): Promise<void> {
  if (action === "approve") {
    const columns = {
      status: "passed" as const,
      source: "staff",
      sourceUrl: null,
      result: { reviewedBy: reviewer.name, ...(note ? { note } : {}) },
      checkedAt: new Date(),
    };
    await db
      .insert(schema.supplierVerification)
      .values({
        id: crypto.randomUUID(),
        supplierId,
        check: "human_review",
        ...columns,
      })
      .onConflictDoUpdate({
        target: [schema.supplierVerification.supplierId, schema.supplierVerification.check],
        set: columns,
      });
  } else {
    await db
      .delete(schema.supplierVerification)
      .where(
        and(
          eq(schema.supplierVerification.supplierId, supplierId),
          eq(schema.supplierVerification.check, "human_review"),
        ),
      );
  }
  await persistDerivedStatus(supplierId);
}

/** Run the battery for every supplier presented on a request's Top-N.
 *  Idempotent and cheap on re-runs: fresh evidence (within its TTL) is kept,
 *  only due checks execute. Never throws per-supplier — one unreachable
 *  website must not strand the batch. */
export async function runVerificationForRequest(requestId: string): Promise<void> {
  const matches = await db.query.match.findMany({
    where: eq(schema.match.requestId, requestId),
    columns: { supplierId: true },
  });
  const supplierIds = [...new Set(matches.map((m) => m.supplierId))];
  if (supplierIds.length === 0) return;

  await ensureSanctionsFresh();

  const suppliers = await db.query.supplier.findMany({
    where: inArray(schema.supplier.id, supplierIds),
  });

  for (const supplier of suppliers) {
    try {
      const evidence = await db.query.supplierVerification.findMany({
        where: eq(schema.supplierVerification.supplierId, supplier.id),
      });
      const statuses = new Map<VerificationCheck, VerificationOutcome>(
        evidence.map((row) => [row.check, row.status]),
      );
      const freshUntil = new Map(
        evidence.map((row) => [
          row.check,
          row.checkedAt.getTime() + CHECK_TTL_DAYS[row.check] * 86_400_000,
        ]),
      );

      for (const check of AUTO_CHECKS) {
        if ((freshUntil.get(check) ?? 0) > Date.now()) continue;

        const outcome = await RUNNERS[check](supplier);
        const columns = {
          status: outcome.status,
          source: outcome.source ?? null,
          sourceUrl: outcome.sourceUrl ?? null,
          result: outcome.result ?? null,
          checkedAt: new Date(),
        };
        await db
          .insert(schema.supplierVerification)
          .values({ id: crypto.randomUUID(), supplierId: supplier.id, check, ...columns })
          .onConflictDoUpdate({
            target: [schema.supplierVerification.supplierId, schema.supplierVerification.check],
            set: columns,
          });
        statuses.set(check, outcome.status);
      }

      // Derive → project onto the legacy column (this module = single writer).
      // A staff decision persists as a human_review row, so the derivation
      // never silently downgrades it.
      const status = deriveVerificationStatus(
        [...statuses.entries()].map(([check, outcome]) => ({ check, status: outcome })),
      );
      if (status !== supplier.verificationStatus) {
        await db
          .update(schema.supplier)
          .set({ verificationStatus: status })
          .where(eq(schema.supplier.id, supplier.id));
      }
      console.log(`verification: ${supplier.name} → ${status}`);
    } catch (error) {
      console.error(`verification: supplier ${supplier.id} battery failed —`, error);
    }
  }
}
