// E10 staff review surface (`/interne/verification`) — the queue of every
// supplier that has verification evidence, with the per-check rows, and the
// staff decision (approve → human_review row → Tier 3 "Vérifié OSI";
// revoke → row deleted, tier falls back to the automated evidence). Status
// writes go through src/server/verification.ts only (single-writer rule).

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { VerificationCheck, VerificationOutcome, VerificationStatus } from "@/database/schema";
import type { TrustTier } from "@/lib/verification";

/** The check-specific facts the screen renders — typed projection of the
 *  evidence row's jsonb `result`. */
export type EvidenceDetail = {
  registryName?: string;
  snapshotAt?: string;
  activity?: string;
  reason?: string;
  siteStatus?: number;
  mx?: boolean;
  youngDomain?: boolean;
  domainRegisteredAt?: string;
  reviewedBy?: string;
  note?: string;
  matches?: Array<{ uid: string; name: string; program: string | null }>;
};

export type EvidenceView = {
  check: VerificationCheck;
  status: VerificationOutcome;
  source: string | null;
  sourceUrl: string | null;
  detail: EvidenceDetail;
  checkedAt: string;
};

export type VerificationQueueRow = {
  supplierId: string;
  name: string;
  countryCode: string;
  website: string | null;
  verificationStatus: VerificationStatus;
  tier: TrustTier;
  sanctionsHit: boolean;
  evidence: EvidenceView[];
};

/** owner|manager only — same feature gate as the route (roles.ts). */
async function requireVerificationStaff() {
  const [{ auth }, { getRequest }, { hasPlatformFeature }] = await Promise.all([
    import("@/server/auth"),
    import("@tanstack/react-start/server"),
    import("@/lib/roles"),
  ]);
  const session = await auth.api.getSession({ headers: getRequest().headers });
  if (!session) return null;
  // Staff powers only from the internal workspace (2026-08-27).
  const { effectivePlatformRole } = await import("@/server/workspace-guard");
  if (!hasPlatformFeature(await effectivePlatformRole(session), "verification")) return null;
  return session;
}

export const getVerificationQueueFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<VerificationQueueRow[]> => {
    const session = await requireVerificationStaff();
    if (!session) return [];

    const [{ db }, { desc, inArray }, schema, { deriveTier }] = await Promise.all([
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
      import("@/lib/verification"),
    ]);

    // Every supplier that has been through the battery (= was presented on a
    // Top-N). The evidence rows ARE the queue — no separate workflow table.
    const evidence = await db.query.supplierVerification.findMany({
      orderBy: [desc(schema.supplierVerification.checkedAt)],
      limit: 2000,
    });
    if (evidence.length === 0) return [];

    const supplierIds = [...new Set(evidence.map((row) => row.supplierId))];
    const suppliers = await db.query.supplier.findMany({
      where: inArray(schema.supplier.id, supplierIds),
    });
    const toDetail = (result: Record<string, unknown> | null): EvidenceDetail => {
      const r = result ?? {};
      const detail: EvidenceDetail = {};
      if (typeof r["registryName"] === "string") detail.registryName = r["registryName"];
      if (typeof r["snapshotAt"] === "string") detail.snapshotAt = r["snapshotAt"];
      if (typeof r["activity"] === "string") detail.activity = r["activity"];
      if (typeof r["reason"] === "string") detail.reason = r["reason"];
      if (typeof r["siteStatus"] === "number") detail.siteStatus = r["siteStatus"];
      if (typeof r["mx"] === "boolean") detail.mx = r["mx"];
      if (r["youngDomain"] === true) detail.youngDomain = true;
      if (typeof r["domainRegisteredAt"] === "string")
        detail.domainRegisteredAt = r["domainRegisteredAt"];
      if (typeof r["reviewedBy"] === "string") detail.reviewedBy = r["reviewedBy"];
      if (typeof r["note"] === "string") detail.note = r["note"];
      if (Array.isArray(r["matches"])) {
        detail.matches = (r["matches"] as Array<Record<string, unknown>>).map((m) => ({
          uid: String(m["uid"] ?? "?"),
          name: String(m["name"] ?? "?"),
          program: typeof m["program"] === "string" ? m["program"] : null,
        }));
      }
      return detail;
    };

    const bySupplier = new Map<string, EvidenceView[]>();
    for (const row of evidence) {
      const list = bySupplier.get(row.supplierId) ?? [];
      list.push({
        check: row.check,
        status: row.status,
        source: row.source,
        sourceUrl: row.sourceUrl,
        detail: toDetail(row.result),
        checkedAt: row.checkedAt.toISOString(),
      });
      bySupplier.set(row.supplierId, list);
    }

    const rows = suppliers.map((supplier) => {
      const supplierEvidence = bySupplier.get(supplier.id) ?? [];
      const { tier, sanctionsHit } = deriveTier(supplierEvidence);
      return {
        supplierId: supplier.id,
        name: supplier.name,
        countryCode: supplier.countryCode,
        website: supplier.website,
        verificationStatus: supplier.verificationStatus,
        tier,
        sanctionsHit,
        evidence: supplierEvidence.sort((a, b) => a.check.localeCompare(b.check)),
      };
    });

    // Review priority: sanctions alerts first, then the evidenced-but-
    // unvouched (tiers 1-2), then tier 0, verified last.
    const priority = (row: VerificationQueueRow) =>
      row.sanctionsHit ? 0 : row.tier === 3 ? 3 : row.tier >= 1 ? 1 : 2;
    return rows.sort((a, b) => priority(a) - priority(b) || a.name.localeCompare(b.name));
  },
);

/** Approve (→ Tier 3) or revoke a supplier's human review. */
export const reviewSupplierFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      supplierId: z.string(),
      action: z.enum(["approve", "revoke"]),
      note: z.string().trim().max(300).optional(),
    }),
  )
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const session = await requireVerificationStaff();
    if (!session) return { ok: false };

    const { recordHumanReview } = await import("@/server/verification");
    await recordHumanReview(
      data.supplierId,
      { id: session.user.id, name: session.user.name },
      data.action,
      data.note,
    );
    const [{ db }, { eq }, schema, { logAudit, actorOf }] = await Promise.all([
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
      import("@/server/audit"),
    ]);
    const supplier = await db.query.supplier.findFirst({
      where: eq(schema.supplier.id, data.supplierId),
      columns: { name: true },
    });
    await logAudit({
      ...actorOf(session),
      action: data.action === "approve" ? "supplier.verified" : "supplier.verification_revoked",
      target: supplier?.name ?? data.supplierId,
    });
    return { ok: true };
  });
