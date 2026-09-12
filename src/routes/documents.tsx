import { createFileRoute, Link } from "@tanstack/react-router";
import { Download, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { accountOptions } from "@/components/osi/AccountFilter";
import { EmptySection } from "@/components/osi/EmptySection";
import { applyListFilters, ListFiltersBar, useListFilters } from "@/components/osi/ListFilters";
import { getDocumentsFn, type DocumentListResult } from "@/lib/document-fns";
import { formatDayTime } from "@/lib/instant";

export const Route = createFileRoute("/documents")({
  head: () => ({
    meta: [
      { title: "Documents d'approvisionnement | OSI" },
      {
        name: "description",
        content:
          "Contrats, certificats, rapports d'inspection et documents douaniers centralisés dans OSI.",
      },
      { property: "og:title", content: "Documents | OSI" },
      {
        property: "og:description",
        content: "Tous vos documents d'approvisionnement au même endroit.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: async (): Promise<DocumentListResult> => getDocumentsFn(),
  component: Documents,
});

/** Bytes, in the unit a person reads. */
function readableSize(bytes: number, lang: string): string {
  const mb = bytes / 1_048_576;
  return mb >= 1
    ? `${new Intl.NumberFormat(lang, { maximumFractionDigits: 1 }).format(mb)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} kB`;
}

function Documents() {
  const { t, i18n } = useTranslation();
  const { items, crossAccount } = Route.useLoaderData();
  const filters = useListFilters();
  // Filtered on when the document ARRIVED — the only date it has that means
  // anything to a reader looking for "what came in this week".
  const shown = applyListFilters(items, filters, {
    accountOf: (doc) => doc.organizationId,
    dateOf: (doc) => doc.createdAt,
  });

  // Same view for staff and buyers: OSI's own workspace holds no customer
  // data (owner 2026-08-29), so the old "Mes données" split had nothing to
  // separate.
  return (
    <div className="space-y-6 pt-6">
      <header className="min-w-0">
        <h1 className="truncate font-display text-2xl font-semibold">{t("documents.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("documents.subtitle", { count: shown.length })}
        </p>
      </header>

      <ListFiltersBar
        filters={filters}
        // The account dimension only exists for a reader who spans accounts.
        {...(crossAccount ? { accounts: accountOptions(items) } : {})}
        total={items.length}
        shown={shown.length}
      />

      {shown.length === 0 ? (
        <EmptySection
          icone={FileText}
          titleKey="empty.documentsTitle"
          textKey="empty.documentsText"
        />
      ) : (
        <div className="card-surface overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-3 font-medium">{t("documents.colFile")}</th>
                <th className="px-4 py-3 font-medium">{t("documents.colKind")}</th>
                <th className="px-4 py-3 font-medium">{t("documents.colSource")}</th>
                {crossAccount && (
                  <th className="px-4 py-3 font-medium">{t("documents.colAccount")}</th>
                )}
                <th className="px-4 py-3 font-medium">{t("documents.colAdded")}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {shown.map((doc) => (
                <tr key={doc.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <span className="block max-w-[280px] truncate font-medium" title={doc.filename}>
                      {doc.filename}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {readableSize(doc.size, i18n.language)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs">{t(`documents.kind.${doc.kind}`)}</td>
                  {/* BOTH sources, each named and each reachable. A bare
                      supplier name told the reader a document came from
                      somewhere without saying where, or letting them go.
                      Either can be null: the references are SET NULL, so a
                      document survives the request or quote it arrived
                      against, and then the snapshot is all that is left. */}
                  <td className="px-4 py-3 text-xs">
                    <span className="flex items-baseline gap-1.5">
                      <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
                        {t("documents.fromRequest")}
                      </span>
                      {doc.requestId ? (
                        <Link
                          to="/demandes/$id"
                          params={{ id: doc.requestId }}
                          className="min-w-0 truncate hover:text-gold"
                        >
                          #{doc.requestId}
                          {doc.requestTitle ? ` — ${doc.requestTitle}` : ""}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">{t("documents.sourceGone")}</span>
                      )}
                    </span>
                    <span className="mt-0.5 flex items-baseline gap-1.5">
                      <span className="shrink-0 text-[10px] uppercase tracking-wider text-muted-foreground">
                        {t("documents.fromQuote")}
                      </span>
                      {doc.quoteId ? (
                        <Link
                          to="/soumissions"
                          hash={`quote-${doc.quoteId}`}
                          className="min-w-0 truncate hover:text-gold"
                        >
                          {doc.supplierName ?? t("documents.sourceGone")}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">
                          {doc.supplierName ?? t("documents.sourceGone")}
                        </span>
                      )}
                    </span>
                  </td>
                  {crossAccount && (
                    <td className="px-4 py-3 text-xs">{doc.organizationName ?? "—"}</td>
                  )}
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {formatDayTime(doc.createdAt, i18n.language)}
                    {doc.uploadedByName && (
                      <span className="block text-[11px]">{doc.uploadedByName}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {/* A plain link, not a fetch: the download route already
                        does its own tenancy check and streams the bytes. */}
                    <a
                      href={`/api/files/${doc.fileId}`}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs transition-colors hover:border-gold hover:text-gold"
                    >
                      <Download className="size-3.5" /> {t("documents.download")}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
