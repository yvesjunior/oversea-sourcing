import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { ArchiveRestore } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/lib/instant";
import { archivePurgeDue } from "@/lib/retention";
import { restoreWorkspaceFn } from "@/lib/settings-fns";

// The recovery screen (2026-09-12). A workspace carrying financial activity is
// archived rather than destroyed, and this is where its owner lands on the next
// sign-in — the archive is meant to be undone by the person who asked for it,
// without a support conversation.
//
// Every other route redirects here while the active workspace is archived
// (see __root's beforeLoad), so this page must work with nothing else loaded.

export const Route = createFileRoute("/recuperation")({
  head: () => ({
    meta: [{ title: "Récupérer votre espace | OSI" }, { name: "robots", content: "noindex" }],
  }),
  component: Recuperation,
});

function Recuperation() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { archivedWorkspace } = Route.useRouteContext();
  const [restoring, setRestoring] = useState(false);
  const [failed, setFailed] = useState(false);

  const restore = async () => {
    if (restoring) return;
    setRestoring(true);
    setFailed(false);
    try {
      const result = await restoreWorkspaceFn();
      if (!result.ok) {
        setFailed(true);
        return;
      }
      // The guard reads the context, so the router has to re-run beforeLoad
      // before anything else will let us through.
      await router.invalidate();
      await router.navigate({ to: "/" });
    } finally {
      setRestoring(false);
    }
  };

  // Reached directly once the workspace is back: nothing to recover.
  if (!archivedWorkspace) {
    return (
      <div className="mx-auto max-w-lg pt-24 text-center">
        <p className="text-sm text-muted-foreground">{t("recovery.nothingToRecover")}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg pt-20">
      <div className="card-surface p-8 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-xl bg-gold-soft text-gold">
          <ArchiveRestore className="size-5" />
        </span>
        <h1 className="mt-4 font-display text-xl font-semibold">{t("recovery.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("recovery.body", {
            workspace: archivedWorkspace.name,
            date: formatDay(archivedWorkspace.archivedAt, i18n.language),
          })}
        </p>
        <p className="mt-3 text-xs text-muted-foreground">{t("recovery.kept")}</p>
        {/* A concrete date, not "six years": the person reading this wants to
            know how long they have, and a duration makes them do arithmetic. */}
        <p className="mt-1 text-xs text-muted-foreground">
          {t("recovery.keptUntil", {
            date: formatDay(
              archivePurgeDue(new Date(archivedWorkspace.archivedAt)).toISOString(),
              i18n.language,
            ),
          })}
        </p>
        <Button variant="gold" className="mt-6" disabled={restoring} onClick={() => void restore()}>
          {restoring ? t("recovery.restoring") : t("recovery.restore")}
        </Button>
        {failed && (
          <p role="alert" className="mt-3 text-xs text-destructive">
            {t("recovery.failed")}
          </p>
        )}
      </div>
    </div>
  );
}
