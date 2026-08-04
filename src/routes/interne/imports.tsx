import { createFileRoute } from "@tanstack/react-router";
import { Import } from "lucide-react";
import { EmptySection } from "@/components/osi/EmptySection";
import { requirePlatformFeature } from "@/lib/auth-guard";

export const Route = createFileRoute("/interne/imports")({
  head: () => ({
    meta: [{ title: "Imports | OSI" }, { name: "robots", content: "noindex" }],
  }),
  beforeLoad: ({ context }) => {
    requirePlatformFeature(context.session, "imports");
  },
  component: () => (
    <EmptySection icone={Import} titleKey="empty.importsTitle" textKey="empty.importsText" />
  ),
});
