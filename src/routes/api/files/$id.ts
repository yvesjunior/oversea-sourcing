import { createFileRoute } from "@tanstack/react-router";

// Attachment download (E3). Own auth + tenancy: own workspace, or an employee
// with cross-workspace read (canSeeAllRequests) — mirrors the dossier rules.

export const Route = createFileRoute("/api/files/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const [{ auth }, { db }, { eq }, schema, storage, { canSeeAllRequests }] =
          await Promise.all([
            import("@/server/auth"),
            import("@/database"),
            import("drizzle-orm"),
            import("@/database/schema"),
            import("@/server/storage"),
            import("@/lib/roles"),
          ]);
        const session = await auth.api.getSession({ headers: request.headers });
        const workspaceId = session?.session.activeOrganizationId;
        if (!session || !workspaceId) {
          return Response.json({ error: "unauthorized" }, { status: 401 });
        }

        const row = await db.query.file.findFirst({
          where: eq(schema.file.id, params.id),
        });
        if (!row) return Response.json({ error: "not found" }, { status: 404 });

        const isOwn = row.organizationId === workspaceId;
        if (!isOwn) {
          // Cross-tenant read: staff powers only from the internal workspace.
          const { effectiveHasPermission } = await import("@/server/workspace-guard");
          if (!(await effectiveHasPermission(session, "requests.all"))) {
            return Response.json({ error: "not found" }, { status: 404 });
          }
        }

        const { Readable } = await import("node:stream");
        const stream = Readable.toWeb(storage.getFileStream(row.storageKey)) as ReadableStream;
        const encodedName = encodeURIComponent(row.filename);
        return new Response(stream, {
          headers: {
            "content-type": row.mime,
            "content-length": String(row.size),
            "content-disposition": `attachment; filename*=UTF-8''${encodedName}`,
            "cache-control": "private, no-store",
          },
        });
      },
    },
  },
});
