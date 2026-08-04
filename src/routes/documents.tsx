import { createFileRoute } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import { EmployeeTabs, MineEmpty } from "@/components/osi/EmployeeTabs";
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
  const { session } = Route.useRouteContext();
  const platformRole = (session?.user as { platformRole?: string } | undefined)?.platformRole;
  const employee = canSeeAllRequests(platformRole);

  // Placeholder until the documents table ships (doc/BACKLOG.md).
  const contenu = (
    <EmptySection icone={FileText} titleKey="empty.documentsTitle" textKey="empty.documentsText" />
  );

  if (!employee) return contenu;

  return (
    <div className="pt-6">
      <EmployeeTabs global={contenu} mine={<MineEmpty />} />
    </div>
  );
}
