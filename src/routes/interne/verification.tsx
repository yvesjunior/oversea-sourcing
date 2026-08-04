import { createFileRoute } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { EmptySection } from "@/components/osi/EmptySection";
import { requirePlatformFeature } from "@/lib/auth-guard";

export const Route = createFileRoute("/interne/verification")({
  head: () => ({
    meta: [{ title: "Vérification fournisseurs | OSI" }, { name: "robots", content: "noindex" }],
  }),
  beforeLoad: ({ context }) => {
    requirePlatformFeature(context.session, "verification");
  },
  component: () => (
    <EmptySection
      icone={ShieldCheck}
      titleKey="empty.verificationTitle"
      textKey="empty.verificationText"
    />
  ),
});
