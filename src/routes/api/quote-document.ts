import { createFileRoute } from "@tanstack/react-router";

// Offer paperwork upload (P8, first slice) — multipart POST with `quoteId`
// and one or more `files`. Creates a `file` row per upload and a `document`
// row pointing at it, so the result appears on the Documents page.
//
// /api/* bypasses the root auth guard AND the serverFn CSRF middleware, so
// this handler does its own session and permission checks — same shape as
// /api/contract-file, same gate: STAFF (`deals`), because the supplier has no
// account and every offer reaches OSI through a person.
//
// The bytes land in the uploads volume, which scripts/backup.sh has archived
// alongside the database since 2026-08-29. A supplier's signed quotation that
// exists only in a volume no backup covers is not a record, it is a hope.

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_FILES = 5;
// A quotation arrives as a PDF or a photo of one. Deliberately narrower than
// /api/upload: no CSV, no plain text, nothing executable.
const ALLOWED_MIME = new Set(["application/pdf", "image/png", "image/jpeg"]);

export const Route = createFileRoute("/api/quote-document")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const [{ auth }, { db }, { eq }, schema, storage, { effectiveHasPermission }] =
          await Promise.all([
            import("@/server/auth"),
            import("@/database"),
            import("drizzle-orm"),
            import("@/database/schema"),
            import("@/server/storage"),
            import("@/server/workspace-guard"),
          ]);
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });
        if (!(await effectiveHasPermission(session, "deals"))) {
          return Response.json({ error: "forbidden" }, { status: 403 });
        }

        const form = await request.formData();
        const quoteId = form.get("quoteId");
        if (typeof quoteId !== "string" || !quoteId) {
          return Response.json({ error: "missing quoteId" }, { status: 400 });
        }
        const quote = await db.query.quote.findFirst({ where: eq(schema.quote.id, quoteId) });
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
            // The BUYER's workspace owns it — it is their supplier's offer,
            // and scoping it to OSI's would hide the document from the tenant
            // whose paperwork it is.
            organizationId: quote.organizationId,
            storageKey,
            filename: upload.name,
            mime: upload.type,
            size: upload.size,
            uploadedBy: session.user.id,
          });
          const documentId = crypto.randomUUID();
          await db.insert(schema.document).values({
            id: documentId,
            organizationId: quote.organizationId,
            fileId,
            kind: "offer",
            quoteId: quote.id,
            requestId: quote.requestId,
            uploadedBy: session.user.id,
            uploadedByName: session.user.name,
          });
          saved.push({ id: documentId, filename: upload.name });
        }

        const { logAudit, actorOf } = await import("@/server/audit");
        await logAudit({
          ...actorOf(session),
          organizationId: quote.organizationId,
          action: "document.uploaded",
          target: quote.supplierName,
          detail: { request: quote.requestId, count: saved.length },
        });

        return Response.json({ documents: saved });
      },
    },
  },
});
