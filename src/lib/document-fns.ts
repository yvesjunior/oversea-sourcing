// Documents (Phase P8, first slice) — the typed rows over `file`.
//
// Read path only; the write path is /api/routes/quote-document.ts, because a
// multipart upload cannot go through a server function.

import { createServerFn } from "@tanstack/react-start";
import type { DocumentKind } from "@/database/schema";

export type DocumentView = {
  id: string;
  fileId: string;
  filename: string;
  mime: string;
  size: number;
  kind: DocumentKind;
  /** Where it came from. Both references are SET NULL rather than cascade, so
   *  a document outlives the request or quote it arrived against — the name
   *  snapshots below are what keep the row readable when that happens. */
  requestId: string | null;
  requestTitle: string | null;
  quoteId: string | null;
  supplierName: string | null;
  uploadedByName: string | null;
  createdAt: string;
  /** The owning workspace, named — only useful to staff reading every account.
   *  Empty rather than null so the account filter can group on it directly. */
  organizationId: string;
  organizationName: string;
};

export type DocumentListResult = {
  items: DocumentView[];
  /** True when the caller is reading across accounts (staff in the internal
   *  workspace), which is what turns on the account column and its filter. */
  crossAccount: boolean;
};

const EMPTY: DocumentListResult = { items: [], crossAccount: false };

/**
 * Every document the caller may see.
 *
 * A buyer sees their own workspace. Staff standing in the internal workspace
 * see every account's — the same two tiers as the requests and quotes lists,
 * resolved from `requests.all` rather than re-deriving a rule.
 */
export const getDocumentsFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<DocumentListResult> => {
    const [
      { requireWorkspaceRole, effectiveHasPermission },
      { auth },
      { getRequest },
      { db },
      { desc, eq },
      schema,
    ] = await Promise.all([
      import("@/server/workspace-guard"),
      import("@/server/auth"),
      import("@tanstack/react-start/server"),
      import("@/database"),
      import("drizzle-orm"),
      import("@/database/schema"),
    ]);
    const headers = getRequest().headers;
    const caller = await requireWorkspaceRole(headers, "viewer");
    const session = await auth.api.getSession({ headers });
    if (!caller || !session) return EMPTY;
    const crossAccount = await effectiveHasPermission(session, "requests.all");

    const rows = await db
      .select({
        document: schema.document,
        file: schema.file,
        requestTitle: schema.request.title,
        supplierName: schema.quote.supplierName,
        // The request a quote-only document belongs to — `document.request_id`
        // may be null while `quote_id` is set.
        quoteRequestId: schema.quote.requestId,
        organizationName: schema.organization.name,
      })
      .from(schema.document)
      .innerJoin(schema.file, eq(schema.file.id, schema.document.fileId))
      .leftJoin(schema.request, eq(schema.request.id, schema.document.requestId))
      .leftJoin(schema.quote, eq(schema.quote.id, schema.document.quoteId))
      .leftJoin(schema.organization, eq(schema.organization.id, schema.document.organizationId))
      .where(crossAccount ? undefined : eq(schema.document.organizationId, caller.workspaceId))
      .orderBy(desc(schema.document.createdAt));

    // A workspace's own list leaves out what hangs from a pack-flow request:
    // a supplier's quotation is the supplier, by name, with its price — the
    // very thing the buyer is not shown before the Decision Pack. Staff
    // reading across accounts see everything.
    const { packFlowRequestIds } = await import("@/server/request-flow");
    const packFlow = crossAccount
      ? new Set<string>()
      : await packFlowRequestIds(
          rows
            .map((row) => row.document.requestId ?? row.quoteRequestId)
            .filter((id): id is string => id !== null),
        );
    const shown = rows.filter((row) => {
      const requestId = row.document.requestId ?? row.quoteRequestId;
      return requestId === null || !packFlow.has(requestId);
    });

    return {
      crossAccount,
      items: shown.map((row) => ({
        id: row.document.id,
        fileId: row.document.fileId,
        filename: row.file.filename,
        mime: row.file.mime,
        size: row.file.size,
        kind: row.document.kind,
        requestId: row.document.requestId,
        requestTitle: row.requestTitle ?? null,
        quoteId: row.document.quoteId,
        supplierName: row.supplierName ?? null,
        uploadedByName: row.document.uploadedByName,
        createdAt: row.document.createdAt.toISOString(),
        organizationId: row.document.organizationId,
        organizationName: row.organizationName ?? "",
      })),
    };
  },
);
