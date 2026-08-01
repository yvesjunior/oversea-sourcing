import { createFileRoute } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import { EmptySection } from "@/components/osi/EmptySection";

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
  component: () => (
    <EmptySection icone={FileText} titleKey="empty.documentsTitle" textKey="empty.documentsText" />
  ),
});
