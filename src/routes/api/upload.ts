import { createFileRoute } from "@tanstack/react-router";

// Attachment upload (E3): multipart POST with `requestId` + one or more `files`.
// /api/* bypasses the root auth guard AND the serverFn CSRF middleware, so this
// handler does its own session + tenancy checks (own workspace only).

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",
]);

export const Route = createFileRoute("/api/upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const [{ auth }, { db }, { eq }, schema, storage] = await Promise.all([
          import("@/server/auth"),
          import("@/database"),
          import("drizzle-orm"),
          import("@/database/schema"),
          import("@/server/storage"),
        ]);
        const session = await auth.api.getSession({ headers: request.headers });
        const workspaceId = session?.session.activeOrganizationId;
        if (!session || !workspaceId) {
          return Response.json({ error: "unauthorized" }, { status: 401 });
        }

        const form = await request.formData();
        const requestId = form.get("requestId");
        if (typeof requestId !== "string" || !requestId) {
          return Response.json({ error: "missing requestId" }, { status: 400 });
        }
        const row = await db.query.request.findFirst({
          where: eq(schema.request.id, requestId),
        });
        if (!row || row.organizationId !== workspaceId) {
          return Response.json({ error: "not found" }, { status: 404 });
        }

        const files = form.getAll("files").filter((f): f is File => f instanceof File);
        if (files.length === 0) {
          return Response.json({ error: "no files" }, { status: 400 });
        }

        const uploaded: Array<{ id: string; filename: string }> = [];
        for (const upload of files) {
          if (upload.size === 0 || upload.size > MAX_FILE_SIZE) {
            return Response.json(
              { error: "file too large", filename: upload.name },
              { status: 413 },
            );
          }
          if (!ALLOWED_MIME.has(upload.type)) {
            return Response.json(
              { error: "unsupported type", filename: upload.name },
              { status: 415 },
            );
          }
          const storageKey = await storage.putFile(
            Buffer.from(await upload.arrayBuffer()),
            upload.name,
          );
          const fileId = crypto.randomUUID();
          await db.insert(schema.file).values({
            id: fileId,
            organizationId: workspaceId,
            storageKey,
            filename: upload.name,
            mime: upload.type,
            size: upload.size,
            uploadedBy: session.user.id,
          });
          await db.insert(schema.requestAttachment).values({
            id: crypto.randomUUID(),
            requestId,
            fileId,
          });
          uploaded.push({ id: fileId, filename: upload.name });
        }

        const { recordEvent } = await import("@/server/requests");
        await recordEvent(requestId, workspaceId, "attachment.added", {
          count: uploaded.length,
        });

        return Response.json({ files: uploaded });
      },
    },
  },
});
