import { createFileRoute } from "@tanstack/react-router";

// A partner's person reads a document of a dossier (Phase V · V25).
//
// The file's owner is the buyer's workspace, so /api/files refuses a partner
// outright, and /api/portal is the supplier's. This is the partner's own
// path, behind the partner's own guard: `fileForDossier` returns the file
// only if it is a document of a dossier the caller's partner is a party to,
// AND that document is shared with that party.

export const Route = createFileRoute("/api/partner/file/$id")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const [{ requirePartnerSession }, storage, dossier] = await Promise.all([
          import("@/server/party-guard"),
          import("@/server/storage"),
          import("@/server/dossier"),
        ]);
        const session = await requirePartnerSession(request.headers);
        if (!session) return Response.json({ error: "unauthorized" }, { status: 401 });

        // Someone else's file and no such file answer alike.
        const row = await dossier.fileForDossier(
          {
            kind: "partner",
            userId: session.userId,
            userName: session.userName,
            partnerIds: session.partnerIds,
          },
          params.id,
        );
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
