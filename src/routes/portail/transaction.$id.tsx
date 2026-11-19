import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DossierRoom } from "@/components/osi/DossierRoom";
import { getMyDossierFn, postMyMessageFn, startMyThreadFn } from "@/lib/portal-fns";

// The Transaction Room, the SUPPLIER's page (Phase V · V25).
//
// The same dossier the buyer and OSI open at /dossiers/$id, read through the
// supplier's guard: their own offer, OSI, the buyer once its identity has
// been disclosed, the documents and threads shared with them. A dossier their
// supplier is not a party to reads as one that does not exist.
export const Route = createFileRoute("/portail/transaction/$id")({
  loader: async ({ params }) => ({ view: await getMyDossierFn({ data: { id: params.id } }) }),
  head: () => ({ meta: [{ title: "Dossier | Portail fournisseur OSI" }] }),
  component: SupplierDossier,
});

function SupplierDossier() {
  const { t } = useTranslation();
  const router = useRouter();
  const { view } = Route.useLoaderData();
  const refresh = () => void router.invalidate();

  const back = (
    <Link
      to="/portail"
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
        fileUrl={(fileId) => `/api/portal/file/${fileId}`}
        onStartThread={async ({ subject, body }) => {
          const result = await startMyThreadFn({ data: { dealId: view.deal.id, subject, body } });
          if (result.ok) refresh();
          return result;
        }}
        onPost={async (threadId, body) => {
          const result = await postMyMessageFn({ data: { threadId, body } });
          if (result.ok) refresh();
          return result;
        }}
      />
    </section>
  );
}
