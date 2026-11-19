import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DossierRoom } from "@/components/osi/DossierRoom";
import {
  completeHubMilestoneFn,
  getHubDossierFn,
  planHubMilestoneFn,
  postHubMessageFn,
  raiseHubIssueFn,
  startHubThreadFn,
} from "@/lib/partner-portal-fns";

// The Transaction Room, a PARTNER's page (Phase V · V25).
//
// The same dossier, read through the partner's guard: what that kind of
// partner's work needs — never the buyer, the supplier only for an
// inspection, the price only where the work is computed from it — and the
// documents and threads shared with them. A dossier staff did not put their
// partner on reads as one that does not exist.
export const Route = createFileRoute("/partenaires/transaction/$id")({
  loader: async ({ params }) => ({ view: await getHubDossierFn({ data: { id: params.id } }) }),
  head: () => ({ meta: [{ title: "Dossier | Partner Hub OSI" }] }),
  component: PartnerDossier,
});

function PartnerDossier() {
  const { t } = useTranslation();
  const router = useRouter();
  const { view } = Route.useLoaderData();
  const refresh = () => void router.invalidate();

  const back = (
    <Link
      to="/partenaires"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" /> {t("room.backHome")}
    </Link>
  );
  if (!view) {
    return (
      <section className="space-y-4">
        {back}
        <p className="card-surface p-6 text-sm text-muted-foreground">{t("room.notFound")}</p>
      </section>
    );
  }
  return (
    <section className="space-y-4">
      {back}
      <DossierRoom
        view={view}
        fileUrl={(fileId) => `/api/partner/file/${fileId}`}
        onStartThread={async ({ subject, body }) => {
          const result = await startHubThreadFn({ data: { dealId: view.deal.id, subject, body } });
          if (result.ok) refresh();
          return result;
        }}
        onPost={async (threadId, body) => {
          const result = await postHubMessageFn({ data: { threadId, body } });
          if (result.ok) refresh();
          return result;
        }}
        // A partner records the milestones of its own role (V28) and attaches
        // its report; the controls show only on those.
        milestones={{
          onPlan: (kind, plannedAt) =>
            planHubMilestoneFn({ data: { dealId: view.deal.id, kind, plannedAt } }),
          onComplete: (kind, note) =>
            completeHubMilestoneFn({ data: { dealId: view.deal.id, kind, note } }),
          proofEndpoint: "/api/partner/milestone-proof",
          onDone: refresh,
        }}
        issues={{
          onRaise: (kind, description) =>
            raiseHubIssueFn({ data: { dealId: view.deal.id, kind, description } }),
          onDone: refresh,
        }}
      />
    </section>
  );
}
