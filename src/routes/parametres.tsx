import { createFileRoute } from "@tanstack/react-router";
import { Settings } from "lucide-react";
import { EmptySection } from "@/components/osi/EmptySection";

export const Route = createFileRoute("/parametres")({
  head: () => ({
    meta: [
      { title: "Paramètres du compte | OSI" },
      {
        name: "description",
        content:
          "Gérez votre profil, votre équipe, vos préférences de langue et vos règles de sourcing OSI.",
      },
      { property: "og:title", content: "Paramètres | OSI" },
      { property: "og:description", content: "Profil, équipe et préférences de sourcing." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <EmptySection
      icone={Settings}
      titleKey="empty.parametresTitle"
      textKey="empty.parametresText"
    />
  ),
});
