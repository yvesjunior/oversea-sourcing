import { createFileRoute } from "@tanstack/react-router";

// A supplier reads back a file attached to THEIR offer (Phase V · V16).
//
// The file's owner is the buyer's workspace (P8), so /api/files refuses a
// supplier outright. This is the second access path to the same row, and the
// only one a supplier has: `fileForDownload` returns the file only if it is
// attached, as a document, to a quote of the caller's.

export const Route = createFileRoute("/api/portal/file/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const [{ requireSupplierSession }, storage, portal] = await Promise.all([
          import("@/server/party-guard"),
          import("@/server/storage"),
          import("@/server/portal"),
        ]);
        const session = await requireSupplierSession(request.headers);
        if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

        // Someone else's file and no such file answer alike. Two ways a file
        // can be theirs: attached to their own offer (V16), or a document of
        // a dossier their supplier is a party to AND shared with it (V25).
        let row = await portal.fileForDownload(session, params.id);
        if (!row) {
          const { fileForDossier } = await import("@/server/dossier");
          row = await fileForDossier(
            {
              kind: "supplier",
              userId: session.userId,
              userName: session.userName,
              supplierIds: session.supplierIds,
            },
            params.id,
          );
        }
        if (!row) return Response.json({ error: "not found" }, { status: 404 });

        const bytes = await storage.openFileStream(row.storageKey);
        if (!bytes) return Response.json({ error: "not found" }, { status: 404 });

        const { Readable } = await import("node:stream");
        const stream = Readable.toWeb(bytes) as ReadableStream;
        return new Response(stream, {
          headers: {
            "content-type": row.mime,
            "content-length": String(row.size),
            "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
            "cache-control": "private, no-store",
          },
        });
      },
    },
  },
});
