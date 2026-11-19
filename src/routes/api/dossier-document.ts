import { createFileRoute } from "@tanstack/react-router";

// A document added to a dossier (Phase V · V25) — multipart POST with
// `dealId`, one `file`, an optional `label`, and either `sharedWith` (the
// parties that may read it, repeated field) or `supersedesId` (the document
// this one is a new version of).
//
// /api/* bypasses the root auth guard AND the serverFn CSRF middleware, so
// this handler does its own session check. WHO may upload, and who will read
// the result, is decided by `planUpload` (src/server/dossier.ts) BEFORE a
// byte is stored: staff choose the audience, a buyer's upload is the buyer's,
// and a new version inherits the audience of the one it replaces — replacing
// a document must not quietly widen who reads it.
//
// A new version is a NEW row and a new file. Nothing is overwritten: the
// earlier version stays readable at its own address.

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
// What a dossier's paperwork is: a PDF, or a photo of one.
const ALLOWED_MIME = new Set(["application/pdf", "image/png", "image/jpeg"]);

export const Route = createFileRoute("/api/dossier-document")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const [{ auth, ExternalAccountError }, { db }, schema, storage, guard, dossier] =
          await Promise.all([
            import("@/server/auth"),
            import("@/database"),
            import("@/database/schema"),
            import("@/server/storage"),
            import("@/server/workspace-guard"),
            import("@/server/dossier"),
          ]);
        // A supplier's or a partner's session is refused by the getter itself,
        // by throwing — answered here as a refusal, not as a server error.
        let session;
        try {
          session = await auth.api.getSession({ headers: request.headers });
        } catch (error) {
          if (error instanceof ExternalAccountError) {
            return Response.json({ error: "forbidden" }, { status: 403 });
          }
          throw error;
        }
        // `buyer`: a viewer of the workspace reads the dossier and adds nothing.
        const caller = session ? await guard.requireWorkspaceRole(request.headers, "buyer") : null;
        if (!session || !caller) return Response.json({ error: "unauthorized" }, { status: 401 });

        const form = await request.formData();
        const dealId = form.get("dealId");
        const upload = form.get("file");
        if (typeof dealId !== "string" || !dealId) {
          return Response.json({ error: "missing dealId" }, { status: 400 });
        }
        if (!(upload instanceof File) || upload.size === 0) {
          return Response.json({ error: "no file" }, { status: 400 });
        }
        if (upload.size > MAX_FILE_SIZE) {
          return Response.json({ error: "file too large" }, { status: 413 });
        }
        if (!ALLOWED_MIME.has(upload.type)) {
          return Response.json({ error: "unsupported type" }, { status: 415 });
        }
        const supersedesId = form.get("supersedesId");
        const label = form.get("label");
        const reader = {
          kind: "workspace" as const,
          userId: caller.userId,
          userName: caller.userName,
          workspaceId: caller.workspaceId,
          staff: await guard.effectiveHasPermission(session, "deals"),
        };

        // A PROOF of a milestone (V27): `milestone` names the kind. Its own
        // plan — who may attach one and who reads it is the milestone's rule,
        // not the general document's.
        const milestone = form.get("milestone");
        if (typeof milestone === "string" && milestone) {
          const [milestones, { isMilestoneKind }] = await Promise.all([
            import("@/server/milestones"),
            import("@/lib/milestones"),
          ]);
          if (!isMilestoneKind(milestone)) {
            return Response.json({ error: "not_found" }, { status: 404 });
          }
          const proof = await milestones.planProof(reader, dealId, milestone);
          if (!proof.ok) {
            const status =
              proof.reason === "not_found" ? 404 : proof.reason === "forbidden" ? 403 : 409;
            return Response.json({ error: proof.reason }, { status });
          }
          const key = await storage.putFile(Buffer.from(await upload.arrayBuffer()), upload.name);
          const saved = await milestones.recordProof(
            proof,
            { storageKey: key, filename: upload.name, mime: upload.type, size: upload.size },
            { id: caller.userId, name: caller.userName },
          );
          return Response.json({ document: { id: saved.id, filename: upload.name } });
        }

        const plan = await dossier.planUpload(reader, dealId, {
          sharedWith: form.getAll("sharedWith").filter((v): v is string => typeof v === "string"),
          supersedesId: typeof supersedesId === "string" && supersedesId ? supersedesId : null,
        });
        if (!plan.ok) {
          const status =
            plan.reason === "not_found" ? 404 : plan.reason === "forbidden" ? 403 : 409;
          return Response.json({ error: plan.reason }, { status });
        }

        const storageKey = await storage.putFile(
          Buffer.from(await upload.arrayBuffer()),
          upload.name,
        );
        const fileId = crypto.randomUUID();
        const documentId = crypto.randomUUID();
        await db.insert(schema.file).values({
          id: fileId,
          // The BUYER's workspace owns it — ownership follows the paperwork
          // (P8). Who may READ it is `shared_with`, not the owner.
          organizationId: plan.deal.organizationId,
          storageKey,
          filename: upload.name,
          mime: upload.type,
          size: upload.size,
          uploadedBy: caller.userId,
        });
        await db.insert(schema.document).values({
          id: documentId,
          organizationId: plan.deal.organizationId,
          fileId,
          kind: "dossier",
          dealId: plan.deal.id,
          sharedWith: plan.sharedWith,
          version: plan.supersedes ? plan.supersedes.version + 1 : 1,
          supersedesId: plan.supersedes?.id ?? null,
          label:
            plan.supersedes?.label ??
            (typeof label === "string" && label.trim() ? label.trim().slice(0, 120) : null),
          uploadedBy: caller.userId,
          uploadedByName: caller.userName,
        });

        const { logAudit, actorOf } = await import("@/server/audit");
        await logAudit({
          ...actorOf(session),
          organizationId: plan.deal.organizationId,
          action: plan.supersedes ? "dossier.document_versioned" : "dossier.document_added",
          target: plan.deal.title,
          detail: {
            dealId: plan.deal.id,
            filename: upload.name,
            sharedWith: plan.sharedWith.length,
          },
        });
        return Response.json({ document: { id: documentId, filename: upload.name } });
      },
    },
  },
});
