import { useState } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { DossierRoom } from "@/components/osi/DossierRoom";
import {
  addDossierPartnerFn,
  createDossierThreadFn,
  discloseBuyerFn,
  getDossierFn,
  postDossierMessageFn,
  raiseIssueFn,
  settleIssueFn,
  type DossierPage,
} from "@/lib/dossier-fns";
import { formatDay } from "@/lib/instant";
import { completeMilestoneFn, planMilestoneFn } from "@/lib/milestone-fns";

// The Transaction Room, for the WORKSPACE side (Phase V · V25): the buyer's
// members and OSI's staff open the same address and are sent different pages
// — which one is decided on the server from who is calling. A dossier of
// another workspace reads as one that does not exist.
//
// The supplier's and the partner's pages are /portail/transaction/$id and
// /partenaires/transaction/$id: same component, their own guard and their own
// functions.
export const Route = createFileRoute("/dossiers/$id")({
  loader: async ({ params }) => ({ page: await getDossierFn({ data: { id: params.id } }) }),
  head: () => ({ meta: [{ title: "Dossier | OSI" }, { name: "robots", content: "noindex" }] }),
  component: DossierPageView,
});

function DossierPageView() {
  const { t } = useTranslation();
  const router = useRouter();
  const { page } = Route.useLoaderData();
  const refresh = () => void router.invalidate();

  const back = (
    <Link
      to="/transactions"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" /> {t("room.back")}
    </Link>
  );

  if (!page) {
    return (
      <div className="space-y-4 pt-6">
        {back}
        <p className="card-surface p-6 text-sm text-muted-foreground">{t("room.notFound")}</p>
      </div>
    );
  }
  const { view } = page;

  return (
    <div className="max-w-4xl space-y-4 pt-6">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        {back}
        {view.deal.requestId && (
          <Link
            to="/demandes/$id"
            params={{ id: view.deal.requestId }}
            className="text-sm text-gold underline-offset-4 hover:underline"
          >
            {t("room.seeRequest", { id: view.deal.requestId })}
          </Link>
        )}
      </div>
      <DossierRoom
        view={view}
        // The workspace's own download route — which refuses a buyer a
        // dossier file that is not shared with them.
        fileUrl={(fileId) => `/api/files/${fileId}`}
        onStartThread={async (input) => {
          const result = await createDossierThreadFn({ data: { dealId: view.deal.id, ...input } });
          if (result.ok) refresh();
          return result;
        }}
        onPost={async (threadId, body) => {
          const result = await postDossierMessageFn({ data: { threadId, body } });
          if (result.ok) refresh();
          return result;
        }}
        upload={{ onDone: refresh }}
        // Staff record any milestone, on the owning party's behalf. A buyer
        // is sent none it may record, so the controls never show for one.
        milestones={{
          onPlan: (kind, plannedAt) =>
            planMilestoneFn({ data: { dealId: view.deal.id, kind, plannedAt } }),
          onComplete: (kind, note) =>
            completeMilestoneFn({ data: { dealId: view.deal.id, kind, note } }),
          proofEndpoint: "/api/dossier-document",
          onDone: refresh,
        }}
        // The buyer and staff raise an issue; settling one is staff's, and
        // the control shows only where the view says so.
        issues={{
          onRaise: (kind, description) =>
            raiseIssueFn({ data: { dealId: view.deal.id, kind, description } }),
          onSettle: (issueId, status, resolution) =>
            settleIssueFn({ data: { issueId, status, resolution } }),
          onDone: refresh,
        }}
      >
        {view.audience === "staff" && <StaffControls page={page} onChanged={refresh} />}
      </DossierRoom>
    </div>
  );
}

/**
 * What only staff do on a dossier: put a partner on it, and — for a dossier
 * opened before the disclosure was a step of its own — disclose the buyer's
 * identity to the supplier.
 */
function StaffControls({ page, onChanged }: { page: DossierPage; onChanged: () => void }) {
  const { t, i18n } = useTranslation();
  const { view, partners } = page;
  const [partnerId, setPartnerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const run = async (action: () => Promise<{ ok: boolean; reason?: string }>, done: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await action();
      setMessage(
        result.ok
          ? { text: done, error: false }
          : { text: t(`room.refused.${result.reason ?? "not_found"}`), error: true },
      );
      if (result.ok) onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 space-y-3 border-t border-border pt-4 text-xs">
      {/* The disclosure (decision D6): said where it stands, and done here
          when it has not been. */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <p className={view.buyerDisclosedAt ? "text-muted-foreground" : "text-warning"}>
          {view.buyerDisclosedAt
            ? t("room.disclosed", { when: formatDay(view.buyerDisclosedAt, i18n.language) })
            : t("room.notDisclosed")}
        </p>
        {!view.buyerDisclosedAt && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(
                () => discloseBuyerFn({ data: { dealId: view.deal.id } }),
                t("room.disclosedDone"),
              )
            }
          >
            {t("room.disclose")}
          </Button>
        )}
      </div>

      {partners.length > 0 && (
        <form
          className="grid max-w-lg grid-cols-[minmax(0,1fr)_auto] gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!partnerId) return;
            void run(
              () => addDossierPartnerFn({ data: { dealId: view.deal.id, partnerId } }),
              t("room.partnerAdded"),
            ).then(() => setPartnerId(""));
          }}
        >
          <select
            value={partnerId}
            onChange={(e) => setPartnerId(e.target.value)}
            aria-label={t("room.addPartner")}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">{t("room.addPartner")}</option>
            {partners.map((partner) => (
              <option key={partner.id} value={partner.id}>
                {t(`partnersAdmin.kind.${partner.kind}`)} — {partner.name}
              </option>
            ))}
          </select>
          <Button type="submit" size="sm" variant="outline" disabled={busy || !partnerId}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {t("room.addPartnerSubmit")}
          </Button>
        </form>
      )}
      {message && (
        <p
          role={message.error ? "alert" : "status"}
          className={message.error ? "text-destructive" : "text-muted-foreground"}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
