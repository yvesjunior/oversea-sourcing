import { createFileRoute } from "@tanstack/react-router";

// A partner attaches its REPORT to one of its own milestones (Phase V · V28) —
// multipart POST with `dealId`, `milestone` (the kind) and one `file`: an
// inspection report, and from V29 a carrier's or a broker's paperwork.
//
// Behind the PARTNER's guard, like everything under /api/partner. Whether
// THIS partner may attach a document to THIS milestone — a party to the
// dossier, a milestone of its own role that has been recorded — is asked of
// `planProof` before a byte is stored; who will read it (the buyer and the
// partner itself) is decided there too.

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME = new Set(["application/pdf", "image/png", "image/jpeg"]);

export const Route = createFileRoute("/api/partner/milestone-proof")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const [{ requirePartnerSession }, storage, milestones, { isMilestoneKind }] =
          await Promise.all([
            import("@/server/party-guard"),
            import("@/server/storage"),
            import("@/server/milestones"),
            import("@/lib/milestones"),
          ]);
        const session = await requirePartnerSession(request.headers);
        if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

        const form = await request.formData();
        const dealId = form.get("dealId");
        const milestone = form.get("milestone");
        const upload = form.get("file");
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
            kind: "partner",
            userId: session.userId,
            userName: session.userName,
            partnerIds: session.partnerIds,
          },
          dealId,
          milestone,
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
