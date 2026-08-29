import { createFileRoute } from "@tanstack/react-router";

// Countersigned-contract upload (P6): multipart POST with `contractId` + one
// `file`. Returns the `file` row id, which recordManualSignatureFn stores on
// the party as `signed_file_id`.
//
// /api/* bypasses the root auth guard AND the serverFn CSRF middleware, so this
// handler does its own session and permission checks — the same shape as
// /api/upload, with a different gate: this is a STAFF action (`contracts.sign`),
// because the file is evidence about an external party's signature.
//
// The bytes land in the same volume as buyer attachments, which is only
// acceptable since 2026-08-29: scripts/backup.sh now archives that volume
// alongside the database. A signed contract that exists solely in a volume no
// backup covers is not a record, it is a hope.

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
// A countersigned contract comes back as a PDF or a scan. Deliberately
// narrower than /api/upload: no CSV or plain text can be a signed document.
const ALLOWED_MIME = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);

export const Route = createFileRoute("/api/contract-file")({
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
        if (!(await effectiveHasPermission(session, "contracts.sign"))) {
          return Response.json({ error: "forbidden" }, { status: 403 });
        }

        const form = await request.formData();
        const contractId = form.get("contractId");
        if (typeof contractId !== "string" || !contractId) {
          return Response.json({ error: "missing contractId" }, { status: 400 });
        }
        const contract = await db.query.contract.findFirst({
          where: eq(schema.contract.id, contractId),
        });
        if (!contract) return Response.json({ error: "not found" }, { status: 404 });

        const upload = form.get("file");
        if (!(upload instanceof File) || upload.size === 0) {
          return Response.json({ error: "no file" }, { status: 400 });
        }
        if (upload.size > MAX_FILE_SIZE) {
          return Response.json({ error: "file too large" }, { status: 413 });
        }
        if (!ALLOWED_MIME.has(upload.type)) {
          return Response.json({ error: "unsupported type" }, { status: 415 });
        }

        const storageKey = await storage.putFile(
          Buffer.from(await upload.arrayBuffer()),
          upload.name,
        );
        const fileId = crypto.randomUUID();
        await db.insert(schema.file).values({
          id: fileId,
          // The BUYER's workspace owns it, not OSI's: it is their contract, and
          // scoping it to the internal workspace would hide it from the tenant
          // whose paperwork it is.
          organizationId: contract.organizationId,
          storageKey,
          filename: upload.name,
          mime: upload.type,
          size: upload.size,
          uploadedBy: session.user.id,
        });

        return Response.json({ file: { id: fileId, filename: upload.name } });
      },
    },
  },
});
