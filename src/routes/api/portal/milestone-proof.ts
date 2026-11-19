import { createFileRoute } from "@tanstack/react-router";

// A supplier attaches a PROOF to one of its own milestones (Phase V · V27) —
// multipart POST with `dealId`, `milestone` (the kind) and one `file`: a
// photo of the goods on the line, a production report.
//
// Behind the supplier's guard, like everything under /api/portal. Whether
// THIS supplier may attach a proof to THIS milestone — a party to the
// dossier, a milestone that is its own work and has been recorded — is asked
// of `planProof` before a byte is stored; who will read the proof (the
// supplier and the buyer) is decided there too.

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME = new Set(["application/pdf", "image/png", "image/jpeg"]);

export const Route = createFileRoute("/api/portal/milestone-proof")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const [{ requireSupplierSession }, storage, milestones, { isMilestoneKind }] =
          await Promise.all([
            import("@/server/party-guard"),
            import("@/server/storage"),
            import("@/server/milestones"),
            import("@/lib/milestones"),
          ]);
        const session = await requireSupplierSession(request.headers);
        if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

        const form = await request.formData();
        const dealId = form.get("dealId");
        const milestone = form.get("milestone");
        const upload = form.get("file");
        // What the uploader says the document is; checked against what the
        // milestone allows by `planProof`.
        const documentKind = form.get("documentKind");
        if (typeof dealId !== "string" || !dealId || typeof milestone !== "string") {
          return Response.json({ error: "missing fields" }, { status: 400 });
        }
        if (!isMilestoneKind(milestone)) {
          return Response.json({ error: "not_found" }, { status: 404 });
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

        const plan = await milestones.planProof(
          {
            kind: "supplier",
            userId: session.userId,
            userName: session.userName,
            supplierIds: session.supplierIds,
          },
          dealId,
          milestone,
          typeof documentKind === "string" ? documentKind : null,
        );
        if (!plan.ok) {
          // Not theirs and no such dossier answer alike.
          const status =
            plan.reason === "not_found" ? 404 : plan.reason === "forbidden" ? 403 : 409;
          return Response.json({ error: plan.reason }, { status });
        }

        const storageKey = await storage.putFile(
          Buffer.from(await upload.arrayBuffer()),
          upload.name,
        );
        const saved = await milestones.recordProof(
          plan,
          { storageKey, filename: upload.name, mime: upload.type, size: upload.size },
          { id: session.userId, name: session.userName },
        );
        return Response.json({ document: { id: saved.id, filename: upload.name } });
      },
    },
  },
});
