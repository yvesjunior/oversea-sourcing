// The cahier des charges and the KPI profile (Phase V · V19) — reads.
//
// Read-only on purpose: nothing here writes a version. Versions are written
// where a spec is relied on or the criteria change (`src/server/spec.ts`);
// validating and editing them is V20.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { KpiProfileSource } from "@/lib/kpi-profile";
import type { Kpi2Factor } from "@/lib/kpi2";
import type { SpecContent } from "@/lib/request-spec";

export type SpecView = {
  /** The version shown. */
  version: number;
  createdAt: string;
  /** Whose change made it; null = the system. */
  createdByName: string | null;
  content: SpecContent;
  /** Every version of this request's spec, newest first. */
  versions: Array<{ version: number; createdAt: string; createdByName: string | null }>;
  /** The weights in force — the LATEST profile, whichever spec version is
   *  being read: a ranking made today uses today's weights. */
  profile: {
    version: number;
    source: KpiProfileSource;
    /** How much each criterion of the spec counts when suppliers are
     *  ranked, by criterion id. */
    criteria: Record<string, number>;
    /** How offers are compared, in points out of 100. */
    offers: Array<{ factor: Kpi2Factor; weight: number }>;
  } | null;
};

/**
 * A request's specification — the version asked for, or the latest. Null when
 * the caller may not read the request, or when it has no spec (a draft, or a
 * request that finished before specifications existed).
 *
 * Same visibility as the dossier itself: the owning workspace, or staff
 * reading across workspaces from the internal one.
 */
export const getRequestSpecFn = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({ requestId: z.string(), version: z.number().int().positive().optional() }),
  )
  .handler(async ({ data }): Promise<SpecView | null> => {
    const [{ auth }, { getRequest }, { db }, { eq }, schema] = await Promise.all([
      import("@/server/auth"),
      import("@tanstack/react-start/server"),
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);
    const session = await auth.api.getSession({ headers: getRequest().headers });
    const workspaceId = session?.session.activeOrganizationId;
    if (!session || !workspaceId) return null;

    const request = await db.query.request.findFirst({
      where: eq(schema.request.id, data.requestId),
      columns: { id: true, organizationId: true },
    });
    if (!request) return null;
    if (request.organizationId !== workspaceId) {
      const { effectiveHasPermission } = await import("@/server/workspace-guard");
      if (!(await effectiveHasPermission(session, "requests.all"))) return null;
    }

    const { readSpec, specVersions, latestProfile } = await import("@/server/spec");
    const spec = await readSpec(request.id, data.version);
    if (!spec) return null;
    const [versions, profile] = await Promise.all([
      specVersions(request.id),
      latestProfile(request.id),
    ]);

    const { KPI2_FACTORS } = await import("@/lib/kpi2");
    const { criterionWeight } = await import("@/lib/kpi-profile");
    return {
      version: spec.version,
      createdAt: spec.createdAt.toISOString(),
      createdByName: spec.createdByName,
      content: spec.content,
      versions: versions.map((v) => ({
        version: v.version,
        createdAt: v.createdAt.toISOString(),
        createdByName: v.createdByName,
      })),
      profile: profile
        ? {
            version: profile.version,
            source: profile.source,
            criteria: Object.fromEntries(
              spec.content.criteria.map((c) => [c.id, criterionWeight(profile.weights.kpi1, c)]),
            ),
            offers: KPI2_FACTORS.map((factor) => ({
              factor,
              weight: profile.weights.kpi2[factor],
            })),
          }
        : null,
    };
  });
