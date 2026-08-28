import { createFileRoute } from "@tanstack/react-router";

// Staff upload for file-fed data sources (registry-qc's ZIP, future imports).
// PUT with the raw file as body (?filename=…) — streamed to the uploads
// volume, never buffered: registry archives run to hundreds of MB. The key
// is handed to triggerSourceRefreshFn, and the run deletes the file when done.
// /api/* bypasses the root auth guard, so this handler gates itself.

const MAX_SIZE = 1024 * 1024 * 1024; // 1 GB

export const Route = createFileRoute("/api/source-upload")({
  server: {
    handlers: {
      PUT: async ({ request }) => {
        const [{ auth }, { effectiveHasPermission }, storage] = await Promise.all([
          import("@/server/auth"),
          import("@/server/workspace-guard"),
          import("@/server/storage"),
        ]);
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session || !(await effectiveHasPermission(session, "sources"))) {
          return Response.json({ error: "forbidden" }, { status: 403 });
        }

        const declared = Number(request.headers.get("content-length") ?? "0");
        if (declared > MAX_SIZE) {
          return Response.json({ error: "too_large" }, { status: 413 });
        }
        const filename = new URL(request.url).searchParams.get("filename") ?? "source-file";
        if (!request.body) {
          return Response.json({ error: "empty" }, { status: 400 });
        }

        const key = await storage.putFileStream(request.body, filename);
        return Response.json({ key });
      },
    },
  },
});
