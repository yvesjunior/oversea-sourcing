import { createFileRoute } from "@tanstack/react-router";
import { Handshake } from "lucide-react";
import { EmptySection } from "@/components/osi/EmptySection";

export const Route = createFileRoute("/partenaires")({
  head: () => ({
    meta: [
      { title: "Partenaires logistiques et qualité | OSI" },
      {
        name: "description",
        content:
          "Retrouvez bientôt vos partenaires d'inspection, de transport et de financement dans OSI.",
      },
      { property: "og:title", content: "Partenaires | OSI" },
      {
        property: "og:description",
        content: "Inspection, transport et financement au même endroit.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <EmptySection
      icone={Handshake}
      titleKey="empty.partenairesTitle"
      textKey="empty.partenairesText"
    />
  ),
});
