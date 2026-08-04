import { createFileRoute } from "@tanstack/react-router";
import { Handshake } from "lucide-react";
import { EmptySection } from "@/components/osi/EmptySection";
import { requirePlatformFeature } from "@/lib/auth-guard";

export const Route = createFileRoute("/interne/facilitation")({
  head: () => ({
    meta: [{ title: "Facilitation | OSI" }, { name: "robots", content: "noindex" }],
  }),
  beforeLoad: ({ context }) => {
    requirePlatformFeature(context.session, "facilitation");
  },
  component: () => (
    <EmptySection
      icone={Handshake}
      titleKey="empty.facilitationTitle"
      textKey="empty.facilitationText"
    />
  ),
});
