import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DossierRoom } from "@/components/osi/DossierRoom";
import {
  getMyContractsFn,
  getMyDossierFn,
  postMyMessageFn,
  startMyThreadFn,
  type SupplierContractSummary,
} from "@/lib/portal-fns";

// The Transaction Room, the SUPPLIER's page (Phase V · V25).
//
// The same dossier the buyer and OSI open at /dossiers/$id, read through the
// supplier's guard: their own offer, OSI, the buyer once its identity has
// been disclosed, the documents and threads shared with them. A dossier their
// supplier is not a party to reads as one that does not exist.
export const Route = createFileRoute("/portail/transaction/$id")({
  loader: async ({ params }) => {
    const [view, contracts] = await Promise.all([
      getMyDossierFn({ data: { id: params.id } }),
      getMyContractsFn({ data: { dealId: params.id } }),
    ]);
    return { view, contracts: contracts ?? [] };
  },
  head: () => ({ meta: [{ title: "Dossier | Portail fournisseur OSI" }] }),
  component: SupplierDossier,
});

function SupplierDossier() {
  const { t } = useTranslation();
  const router = useRouter();
  const { view, contracts } = Route.useLoaderData();
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
      <Contracts contracts={contracts} />
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

/**
 * The contracts this supplier is a party to on the dossier (V26) — each one
 * leads to its text and, when suppliers sign in the portal, to the signature.
 * Nothing is shown when none has been sent: a supplier is not told about a
 * contract that is still OSI's draft.
 */
function Contracts({ contracts }: { contracts: SupplierContractSummary[] }) {
  const { t } = useTranslation();
  if (contracts.length === 0) return null;
  return (
    <div className="card-surface p-5">
      <h2 className="text-sm font-semibold">{t("portalContract.listTitle")}</h2>
      <ul className="mt-3 space-y-2">
        {contracts.map((contract) => (
          <li key={contract.id}>
            <Link
              to="/portail/contrat/$id"
              params={{ id: contract.id }}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:border-gold/50"
            >
              <span className="min-w-0">
                <span className="block truncate font-medium">
                  {contract.number} — {contract.title}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {t("portalContract.progress", {
                    signed: contract.signed,
                    required: contract.required,
                  })}{" "}
                  · {t(`portalContract.yours.${contract.yourStatus}`)}
                </span>
              </span>
              <span className="shrink-0 rounded-full bg-gold-soft px-2.5 py-1 text-[11px] font-semibold text-gold">
                {t(`portalContract.status.${contract.status}`)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
