import { createFileRoute } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import { EmptySection } from "@/components/osi/EmptySection";
import { canSeeAllRequests } from "@/lib/roles";

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
  component: Documents,
});

function Documents() {
  // Placeholder until the documents table ships (doc/BACKLOG.md).
  const contenu = (
    <EmptySection icone={FileText} titleKey="empty.documentsTitle" textKey="empty.documentsText" />
  );

  // Same view for staff and buyers: OSI's own workspace holds no customer
  // data (owner 2026-08-29), so the old "Mes données" split had nothing to
  // separate.
  return <div className="pt-6">{contenu}</div>;
}
