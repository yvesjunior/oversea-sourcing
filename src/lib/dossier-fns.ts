// The Transaction Room (Phase V · V25) — server functions for the WORKSPACE
// side: a buyer's member, and OSI's staff.
//
// One guard, `workspaceReader`: a workspace session (an external account is
// refused by `auth.api.getSession` itself), which is STAFF when it holds
// `deals` while standing in the internal workspace, and a buyer otherwise.
// What either reads of a dossier is decided in src/lib/dossier.ts; a buyer of
// another workspace reads "no such dossier".
//
// The supplier's and the partner's functions are in portal-fns.ts and
// partner-portal-fns.ts, each behind its own guard.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { DossierView } from "@/lib/dossier";
import type { PartnerKind } from "@/lib/partners";
import type {
  DossierReader,
  DossierSummary,
  DossierWriteResult,
  PartyWriteResult,
} from "@/server/dossier";

export type { DossierSummary, DossierView, DossierWriteResult, PartyWriteResult };

/** `write`: a viewer of the workspace reads a dossier and changes nothing. */
async function workspaceReader(write = false): Promise<DossierReader | null> {
  const [{ requireWorkspaceRole, effectiveHasPermission }, { auth }, { getRequest }] =
    await Promise.all([
      import("@/server/workspace-guard"),
      import("@/server/auth"),
      import("@tanstack/react-start/server"),
    ]);
  const headers = getRequest().headers;
  const session = await auth.api.getSession({ headers });
  const caller = await requireWorkspaceRole(headers, write ? "buyer" : "viewer");
  if (!session || !caller) return null;
  return {
    kind: "workspace",
    userId: caller.userId,
    userName: caller.userName,
    workspaceId: caller.workspaceId,
    staff: await effectiveHasPermission(session, "deals"),
  };
}

/** The dossiers the caller is on: their workspace's, or every one for staff.
 *  Null = no session. */
export const getDossiersFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ items: DossierSummary[]; staff: boolean } | null> => {
    const reader = await workspaceReader();
    if (!reader || reader.kind !== "workspace") return null;
    const { listDossiers } = await import("@/server/dossier");
    return { items: await listDossiers(reader), staff: reader.staff };
  },
);

export type DossierPage = {
  view: DossierView;
  /** STAFF ONLY — the active partners not yet on the dossier. */
  partners: Array<{ id: string; name: string; kind: PartnerKind }>;
};

/** One dossier. Null when it is not the caller's — or does not exist. */
export const getDossierFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ id: z.string().min(1).max(100) }))
  .handler(async ({ data }): Promise<DossierPage | null> => {
    const reader = await workspaceReader();
    if (!reader || reader.kind !== "workspace") return null;
    const { readDossier } = await import("@/server/dossier");
    const view = await readDossier(reader, data.id);
    if (!view) return null;
    if (!reader.staff) return { view, partners: [] };
    const [{ listPartners }, { partnerIdsOn }] = await Promise.all([
      import("@/server/partner-directory"),
      import("@/server/dossier"),
    ]);
    const onIt = await partnerIdsOn(data.id);
    return {
      view,
      partners: (await listPartners())
        .filter((partner) => partner.active && !onIt.has(partner.id))
        .map((partner) => ({ id: partner.id, name: partner.name, kind: partner.kind })),
    };
  });

const body = z.string().trim().min(1).max(4000);

/** Open a thread. Staff choose who it is with; a buyer's is with OSI. */
export const createDossierThreadFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      dealId: z.string().min(1).max(100),
      subject: z.string().trim().min(2).max(160),
      parties: z.array(z.string().min(1).max(100)).max(20).default([]),
      body,
    }),
  )
  .handler(async ({ data }): Promise<DossierWriteResult> => {
    const reader = await workspaceReader(true);
    if (!reader) return { ok: false, reason: "forbidden" };
    const { createThread } = await import("@/server/dossier");
    return createThread(reader, data.dealId, data);
  });

/** Answer in a thread the caller is in. */
export const postDossierMessageFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ threadId: z.string().min(1).max(100), body }))
  .handler(async ({ data }): Promise<DossierWriteResult> => {
    const reader = await workspaceReader(true);
    if (!reader) return { ok: false, reason: "forbidden" };
    const { postMessage } = await import("@/server/dossier");
    return postMessage(reader, data.threadId, data.body);
  });

/** STAFF: put a partner on the dossier. Its people then see their slice of
 *  it in the Partner Hub. */
export const addDossierPartnerFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ dealId: z.string().min(1), partnerId: z.string().min(1) }))
  .handler(async ({ data }): Promise<PartyWriteResult | { ok: false; reason: "forbidden" }> => {
    const reader = await workspaceReader(true);
    if (!reader || reader.kind !== "workspace" || !reader.staff) {
      return { ok: false, reason: "forbidden" };
    }
    const { addPartnerParty } = await import("@/server/dossier");
    return addPartnerParty(data.dealId, data.partnerId, {
      id: reader.userId,
      name: reader.userName,
    });
  });

/**
 * STAFF: disclose the buyer's identity to the supplier (decision D6) on a
 * dossier where it has not been — one opened before V25. A dossier opened
 * since is disclosed by the code that opens it.
 */
export const discloseBuyerFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ dealId: z.string().min(1) }))
  .handler(async ({ data }): Promise<{ ok: boolean; reason?: "forbidden" | "not_found" }> => {
    const reader = await workspaceReader(true);
    if (!reader || reader.kind !== "workspace" || !reader.staff) {
      return { ok: false, reason: "forbidden" };
    }
    const { discloseBuyer } = await import("@/server/dossier");
    const done = await discloseBuyer(data.dealId, { id: reader.userId, name: reader.userName });
    return done ? { ok: true } : { ok: false, reason: "not_found" };
  });
