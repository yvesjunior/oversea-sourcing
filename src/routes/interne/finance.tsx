import { createFileRoute } from "@tanstack/react-router";
import { Wallet } from "lucide-react";
import { EmptySection } from "@/components/osi/EmptySection";
import { requirePlatformFeature } from "@/lib/auth-guard";

export const Route = createFileRoute("/interne/finance")({
  head: () => ({
    meta: [{ title: "Finance | OSI" }, { name: "robots", content: "noindex" }],
  }),
  beforeLoad: ({ context }) => {
    requirePlatformFeature(context.session, "finance");
  },
  component: () => (
    <EmptySection icone={Wallet} titleKey="empty.financeTitle" textKey="empty.financeText" />
  ),
});
