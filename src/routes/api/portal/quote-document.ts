import { createFileRoute } from "@tanstack/react-router";

// A supplier attaches a file to THEIR offer (Phase V · V16) — the portal's
// variant of /api/quote-document, which is staff's.
//
// /api/* bypasses the root guard and the server-fn CSRF middleware, so this
// handler does its own check: `requireSupplierSession`, then the quote must
// be one of the caller's and its window still open (`quoteForUpload`).
//
// THE DOCUMENT BELONGS TO THE BUYER'S WORKSPACE (P8's ownership rule) even
// though the supplier uploads it: it is their supplier's offer, and it is the
// buyer who will hold the dossier it ends up in. The supplier reads it back
// through /api/portal/file — a second access path to the same row. Until the
// Decision Pack discloses the offer, the buyer's own lists leave it out
// (document-fns.ts, api/files), exactly as for a file staff uploaded.

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_FILES = 5;
const ALLOWED_MIME = new Set(["application/pdf", "image/png", "image/jpeg"]);

export const Route = createFileRoute("/api/portal/quote-document")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const [{ requireSupplierSession }, { db }, schema, storage, portal] = await Promise.all([
          import("@/server/party-guard"),
          import("@/database"),
          import("@/database/schema"),
          import("@/server/storage"),
          import("@/server/portal"),
        ]);
        const session = await requireSupplierSession(request.headers);
        if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

        const form = await request.formData();
        const quoteId = form.get("quoteId");
        if (typeof quoteId !== "string" || !quoteId) {
          return Response.json({ error: "missing quoteId" }, { status: 400 });
        }
        // Not theirs, unknown, or its window closed: one answer for all three.
        const quote = await portal.quoteForUpload(session, quoteId);
        if (!quote) return Response.json({ error: "not found" }, { status: 404 });

        const uploads = form
          .getAll("files")
          .filter((f): f is File => f instanceof File && f.size > 0);
        if (uploads.length === 0) return Response.json({ error: "no file" }, { status: 400 });
        if (uploads.length > MAX_FILES) {
          return Response.json({ error: "too many files" }, { status: 413 });
        }
        for (const upload of uploads) {
          if (upload.size > MAX_FILE_SIZE) {
            return Response.json({ error: "file too large" }, { status: 413 });
          }
          if (!ALLOWED_MIME.has(upload.type)) {
            return Response.json({ error: "unsupported type" }, { status: 415 });
          }
        }

        const saved: { id: string; filename: string }[] = [];
        for (const upload of uploads) {
          const storageKey = await storage.putFile(
            Buffer.from(await upload.arrayBuffer()),
            upload.name,
          );
          const fileId = crypto.randomUUID();
          await db.insert(schema.file).values({
            id: fileId,
            organizationId: quote.organizationId,
            storageKey,
            filename: upload.name,
            mime: upload.type,
            size: upload.size,
            uploadedBy: session.userId,
          });
          const documentId = crypto.randomUUID();
          await db.insert(schema.document).values({
            id: documentId,
            organizationId: quote.organizationId,
            fileId,
            kind: "offer",
            quoteId: quote.id,
            requestId: quote.requestId,
            uploadedBy: session.userId,
            uploadedByName: session.userName,
          });
          saved.push({ id: documentId, filename: upload.name });
        }

        const { logAudit } = await import("@/server/audit");
        await logAudit({
          actorId: session.userId,
          actorName: session.userName,
          action: "document.uploaded",
          target: quote.supplierName,
          detail: { request: quote.requestId, count: saved.length, channel: "portal" },
        });
        return Response.json({ documents: saved });
      },
    },
  },
});
