// Signatures (Phase P6) — sending a contract, signing it, recording an offline
// signature, and chasing whoever has not answered.
//
// The rules are pure and live in src/lib/signature.ts; this file is their only
// writer. Two invariants hold across every fn here:
//
//   • The contract's status is NEVER set by hand. After any change to a party
//     row it is recomputed with `statusFromSignatures()`, so the stored status
//     and the N/M indicator cannot drift apart — they are computed from the
//     same rows by the same function.
//   • Every signature writes a `contract_event`, not an `audit_log` row. The
//     journal is purged at three months by owner rule; signature evidence has
//     to outlive that, so it lives beside the contract, permanently.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

type Refusal = { ok: false; reason: string };

/** Recompute status from the party rows and stamp the contract. Returns the
 *  new status so callers can react to completion without re-reading. */
async function syncContractStatus(contractId: string): Promise<string> {
  const [{ db }, { eq }, schema, { statusFromSignatures }] = await Promise.all([
    import("@/database"),
    import("drizzle-orm"),
    import("@/database/schema"),
    import("@/lib/deal-status"),
  ]);
  const parties = await db.query.contractParty.findMany({
    where: eq(schema.contractParty.contractId, contractId),
  });
  const status = statusFromSignatures(parties);
  await db
    .update(schema.contract)
    .set({
      status,
      ...(status === "signed" ? { signedAt: new Date() } : {}),
      updatedAt: new Date(),
    })
    .where(eq(schema.contract.id, contractId));
  return status;
}

/**
 * Send a contract to its parties (staff, `contracts.send`).
 *
 * `draft → sent` is what makes a contract signable: a draft is an internal
 * working copy, and signing one would record consent to a document nobody was
 * shown. The mail itself goes out through the esign seam's external path — for
 * the parties we actually hold an address for, which today is usually none;
 * the send is still the operational fact that OSI put the document out.
 */
export const sendContractFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ contractId: z.string().min(1) }))
  .handler(
    async ({ data }): Promise<{ ok: true; notified: number; recordedOnly: number } | Refusal> => {
      const [{ effectiveHasPermission }, { auth }, { getRequest }, { db }, { eq }, schema] =
        await Promise.all([
          import("@/server/workspace-guard"),
          import("@/server/auth"),
          import("@tanstack/react-start/server"),
          import("@/database"),
          import("drizzle-orm"),
          import("@/database/schema"),
        ]);
      const headers = getRequest().headers;
      const session = await auth.api.getSession({ headers });
      if (!session || !(await effectiveHasPermission(session, "contracts.send"))) {
        return { ok: false, reason: "forbidden" };
      }

      const contract = await db.query.contract.findFirst({
        where: eq(schema.contract.id, data.contractId),
      });
      if (!contract) return { ok: false, reason: "not_found" };
      const { canTransitionContract } = await import("@/lib/deal-status");
      if (!canTransitionContract(contract.status, "sent")) {
        return { ok: false, reason: "not_draft" };
      }

      const parties = await db.query.contractParty.findMany({
        where: eq(schema.contractParty.contractId, contract.id),
      });
      const { esignProvider } = await import("@/server/esign");
      const provider = esignProvider();
      let notified = 0;
      for (const party of parties) {
        const dispatch = await provider.request({
          contractId: contract.id,
          contractNumber: contract.number,
          partyId: party.id,
          partyName: party.name,
          partyEmail: party.email,
        });
        if (dispatch.ok && dispatch.delivered) notified += 1;
      }

      await db
        .update(schema.contract)
        .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.contract.id, contract.id));
      await db.insert(schema.contractEvent).values({
        id: crypto.randomUUID(),
        contractId: contract.id,
        type: "contract.sent",
        actorId: session.user.id,
        actorName: session.user.name,
        detail: { parties: parties.length, notified },
      });

      // The dossier is in its contracting phase now. Guarded, and ignored when
      // the deal has already moved on — sending a second contract must not
      // drag a shipping order backwards.
      const deal = await db.query.deal.findFirst({ where: eq(schema.deal.id, contract.dealId) });
      if (deal?.status === "open") {
        const { transitionDeal } = await import("@/server/deals");
        await transitionDeal(deal.id, deal.organizationId, "open", "contracting");
      }

      // Tell the buyer there is something to sign. The workspace's own people
      // are the audience: OSI's side is staff, who are doing the sending.
      const buyerParty = parties.find((p) => p.role === "buyer");
      if (buyerParty && deal) {
        const request = deal.requestId
          ? await db.query.request.findFirst({ where: eq(schema.request.id, deal.requestId) })
          : undefined;
        if (request?.createdBy) {
          const { notifyUser } = await import("@/server/notify");
          await notifyUser({
            userId: request.createdBy,
            organizationId: contract.organizationId,
            type: "contract_to_sign",
            params: { number: contract.number },
            link: `/contrats/${contract.id}`,
            email: {
              subjectFr: `Un contrat attend votre signature — ${contract.number}`,
              subjectEn: `A contract awaits your signature — ${contract.number}`,
              bodyFr: `Le contrat ${contract.number} est prêt à être signé dans OSI.`,
              bodyEn: `Contract ${contract.number} is ready to sign in OSI.`,
            },
          });
        }
      }

      const { logAudit, actorOf } = await import("@/server/audit");
      await logAudit({
        ...actorOf(session),
        action: "contract.sent",
        target: contract.number,
        detail: { parties: parties.length, notified },
      });
      return { ok: true, notified, recordedOnly: parties.length - notified };
    },
  );

/**
 * Sign in the platform (the buyer's line, or OSI's).
 *
 * The caller signs AS THEMSELVES — there is no "sign on behalf of" here, which
 * is the entire evidentiary value of this path: the signatory is an
 * authenticated session, not a name typed into a form. IP and user agent are
 * recorded beside the timestamp.
 */
export const signContractFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ contractId: z.string().min(1), partyId: z.string().min(1) }))
  .handler(async ({ data }): Promise<{ ok: true; status: string } | Refusal> => {
    const [
      { requireWorkspaceRole, effectiveHasPermission },
      { auth },
      { getRequest },
      { db },
      { and, eq },
      schema,
    ] = await Promise.all([
      import("@/server/workspace-guard"),
      import("@/server/auth"),
      import("@tanstack/react-start/server"),
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);
    const headers = getRequest().headers;
    const caller = await requireWorkspaceRole(headers, "viewer");
    const session = await auth.api.getSession({ headers });
    if (!caller || !session) return { ok: false, reason: "forbidden" };

    const contract = await db.query.contract.findFirst({
      where: eq(schema.contract.id, data.contractId),
    });
    if (!contract) return { ok: false, reason: "not_found" };
    const party = await db.query.contractParty.findFirst({
      where: and(
        eq(schema.contractParty.id, data.partyId),
        eq(schema.contractParty.contractId, contract.id),
      ),
    });
    if (!party) return { ok: false, reason: "not_found" };

    // The pure rules decide; this fn only supplies freshly read facts. The UI
    // ran the same check to choose what to show — that was a courtesy, this is
    // the enforcement.
    const { canSignInPlatform } = await import("@/lib/signature");
    const verdict = canSignInPlatform(contract, party, {
      workspaceId: caller.workspaceId,
      workspaceRole: caller.role,
      maySignForOsi: await effectiveHasPermission(session, "contracts.sign"),
    });
    if (verdict !== "ok") return { ok: false, reason: verdict };

    const request = getRequest();
    await db
      .update(schema.contractParty)
      .set({
        signatureStatus: "signed",
        method: "in_platform",
        signedAt: new Date(),
        signedByName: session.user.name,
        // Filled at signature time, not at draft: this is WHO signed, and
        // until now nobody had.
        userId: session.user.id,
        evidence: {
          ip:
            request.headers.get("cf-connecting-ip") ??
            request.headers.get("x-forwarded-for") ??
            null,
          userAgent: request.headers.get("user-agent") ?? null,
          signedInWorkspace: caller.workspaceId,
        },
      })
      .where(eq(schema.contractParty.id, party.id));

    await db.insert(schema.contractEvent).values({
      id: crypto.randomUUID(),
      contractId: contract.id,
      type: "contract.signed",
      actorId: session.user.id,
      actorName: session.user.name,
      partyId: party.id,
      partyName: party.name,
      detail: { method: "in_platform", role: party.role },
    });

    const status = await syncContractStatus(contract.id);
    if (status === "signed") await notifyContractComplete(contract.id);
    return { ok: true, status };
  });

/**
 * Record an offline signature for an external party (staff, `contracts.sign`).
 *
 * The countersigned PDF is optional on purpose: the operational fact ("X signed
 * on the 3rd") is often known before the scan arrives, and blocking the record
 * on the file would push staff to keep it in their inbox instead.
 */
export const recordManualSignatureFn = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      contractId: z.string().min(1),
      partyId: z.string().min(1),
      signedByName: z.string().trim().min(2).max(120),
      /** A `file` row id from /api/contract-file. */
      fileId: z.string().min(1).optional(),
    }),
  )
  .handler(async ({ data }): Promise<{ ok: true; status: string } | Refusal> => {
    const [{ effectiveHasPermission }, { auth }, { getRequest }, { db }, { and, eq }, schema] =
      await Promise.all([
        import("@/server/workspace-guard"),
        import("@/server/auth"),
        import("@tanstack/react-start/server"),
        import("@/database"),
        import("drizzle-orm"),
        import("@/database/schema"),
      ]);
    const session = await auth.api.getSession({ headers: getRequest().headers });
    if (!session) return { ok: false, reason: "forbidden" };
    const maySign = await effectiveHasPermission(session, "contracts.sign");

    const contract = await db.query.contract.findFirst({
      where: eq(schema.contract.id, data.contractId),
    });
    if (!contract) return { ok: false, reason: "not_found" };
    const party = await db.query.contractParty.findFirst({
      where: and(
        eq(schema.contractParty.id, data.partyId),
        eq(schema.contractParty.contractId, contract.id),
      ),
    });
    if (!party) return { ok: false, reason: "not_found" };

    const { canRecordManual } = await import("@/lib/signature");
    const verdict = canRecordManual(contract, party, { maySignForOsi: maySign });
    if (verdict !== "ok") return { ok: false, reason: verdict };

    await db
      .update(schema.contractParty)
      .set({
        signatureStatus: "signed",
        method: "manual_upload",
        signedAt: new Date(),
        signedByName: data.signedByName.trim(),
        ...(data.fileId ? { signedFileId: data.fileId } : {}),
        // WHO RECORDED IT is part of the evidence: this signature is a staff
        // member's attestation about a document, not an authenticated act by
        // the signatory.
        evidence: {
          recordedBy: session.user.id,
          recordedByName: session.user.name,
          hasDocument: Boolean(data.fileId),
        },
      })
      .where(eq(schema.contractParty.id, party.id));

    await db.insert(schema.contractEvent).values({
      id: crypto.randomUUID(),
      contractId: contract.id,
      type: "contract.signed",
      actorId: session.user.id,
      actorName: session.user.name,
      partyId: party.id,
      partyName: party.name,
      detail: {
        method: "manual_upload",
        role: party.role,
        signedByName: data.signedByName.trim(),
        hasDocument: Boolean(data.fileId),
      },
    });

    const status = await syncContractStatus(contract.id);
    if (status === "signed") await notifyContractComplete(contract.id);
    return { ok: true, status };
  });

/** Chase a party who has not answered (staff, `contracts.send`). */
export const remindPartyFn = createServerFn({ method: "POST" })
  .inputValidator(z.object({ contractId: z.string().min(1), partyId: z.string().min(1) }))
  .handler(async ({ data }): Promise<{ ok: true; mailed: boolean } | Refusal> => {
    const [{ effectiveHasPermission }, { auth }, { getRequest }, { db }, { and, eq }, schema] =
      await Promise.all([
        import("@/server/workspace-guard"),
        import("@/server/auth"),
        import("@tanstack/react-start/server"),
        import("@/database"),
        import("drizzle-orm"),
        import("@/database/schema"),
      ]);
    const session = await auth.api.getSession({ headers: getRequest().headers });
    if (!session || !(await effectiveHasPermission(session, "contracts.send"))) {
      return { ok: false, reason: "forbidden" };
    }

    const contract = await db.query.contract.findFirst({
      where: eq(schema.contract.id, data.contractId),
    });
    if (!contract) return { ok: false, reason: "not_found" };
    const party = await db.query.contractParty.findFirst({
      where: and(
        eq(schema.contractParty.id, data.partyId),
        eq(schema.contractParty.contractId, contract.id),
      ),
    });
    if (!party) return { ok: false, reason: "not_found" };

    const { canRemind } = await import("@/lib/signature");
    if (!canRemind(contract, party)) return { ok: false, reason: "not_pending" };

    let mailed = false;
    if (party.email) {
      const { sendMail } = await import("@/server/mail");
      const result = await sendMail({
        to: party.email,
        subject: `Rappel — contrat ${contract.number} / Reminder — contract ${contract.number}`,
        text: `Le contrat ${contract.number} attend votre signature.\n\nContract ${contract.number} is awaiting your signature.`,
        html: `<p>Le contrat <strong>${contract.number}</strong> attend votre signature.</p><p>Contract <strong>${contract.number}</strong> is awaiting your signature.</p>`,
      });
      mailed = result.ok && !result.skipped;
    }

    // Stamped whether or not a mail went out: the reminder is the staff act,
    // and for a party we hold no address for it happened by phone.
    await db
      .update(schema.contractParty)
      .set({ remindedAt: new Date() })
      .where(eq(schema.contractParty.id, party.id));
    await db.insert(schema.contractEvent).values({
      id: crypto.randomUUID(),
      contractId: contract.id,
      type: "contract.reminded",
      actorId: session.user.id,
      actorName: session.user.name,
      partyId: party.id,
      partyName: party.name,
      detail: { mailed },
    });
    return { ok: true, mailed };
  });

/** Everyone mandatory has signed — tell the buyer their contract is complete. */
async function notifyContractComplete(contractId: string): Promise<void> {
  const [{ db }, { eq }, schema] = await Promise.all([
    import("@/database"),
    import("drizzle-orm"),
    import("@/database/schema"),
  ]);
  const contract = await db.query.contract.findFirst({
    where: eq(schema.contract.id, contractId),
  });
  if (!contract) return;
  const deal = await db.query.deal.findFirst({ where: eq(schema.deal.id, contract.dealId) });
  const request = deal?.requestId
    ? await db.query.request.findFirst({ where: eq(schema.request.id, deal.requestId) })
    : undefined;
  if (!request?.createdBy) return;

  const { notifyUser } = await import("@/server/notify");
  await notifyUser({
    userId: request.createdBy,
    organizationId: contract.organizationId,
    type: "contract_signed",
    params: { number: contract.number },
    link: `/contrats/${contract.id}`,
    email: {
      subjectFr: `Contrat signé — ${contract.number}`,
      subjectEn: `Contract signed — ${contract.number}`,
      bodyFr: `Toutes les signatures obligatoires du contrat ${contract.number} sont réunies.`,
      bodyEn: `Every mandatory signature on contract ${contract.number} is in.`,
    },
  });
}
