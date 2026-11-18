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
        } else {
          // The owning workspace reads no supplier on the pack flow before the
          // Decision Pack (owner, 2026-11-14) — and a supplier's quotation IS
          // the supplier, by name, with its price. The Documents list already
          // leaves these out (document-fns.ts); this is the same rule for
          // someone holding the file's address. Only documents attached to a
          // QUOTE: the buyer's own attachments stay theirs on either flow.
          const quoted = await db
            .select({ quoteId: schema.quote.id, requestId: schema.quote.requestId })
            .from(schema.document)
            .innerJoin(schema.quote, eq(schema.quote.id, schema.document.quoteId))
            .where(eq(schema.document.fileId, row.id));
          if (quoted.length > 0) {
            const [{ packFlowRequestIds }, { disclosedQuoteIds }] = await Promise.all([
              import("@/server/request-flow"),
              import("@/server/decision-pack"),
            ]);
            const packFlow = await packFlowRequestIds(quoted.map((q) => q.requestId));
            // …until the offer is one the buyer HAS been shown: an item of a
            // released pack, not withheld (V12). Its quotation is then part
            // of what they are deciding on.
            const disclosed = await disclosedQuoteIds(quoted.map((q) => q.quoteId));
            if (quoted.some((q) => packFlow.has(q.requestId) && !disclosed.has(q.quoteId))) {
              return Response.json({ error: "not found" }, { status: 404 });
            }
          }
        }

        // The row can outlive its bytes; the adapter says so (and logs the key)
        // BEFORE a response exists, so this is still a 404 and not a connection
        // dropped halfway through the headers.
        const bytes = await storage.openFileStream(row.storageKey);
        if (!bytes) return Response.json({ error: "not found" }, { status: 404 });

        const { Readable } = await import("node:stream");
        const stream = Readable.toWeb(bytes) as ReadableStream;
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
