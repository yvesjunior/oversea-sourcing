import { useState } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { ArrowLeft, Loader2, PenLine } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { formatDayTime } from "@/lib/instant";
import { getMyContractFn, signMyContractFn } from "@/lib/portal-fns";
import { cn } from "@/lib/utils";

// A contract, read — and signed — by the supplier (Phase V · V26).
//
// The supplier's person reads the text their supplier is a party to, and
// signs their own line when the platform lets suppliers sign here. When it
// does not, the page says so and the paper route applies, as it always has:
// staff record the countersigned PDF.
//
// A contract that is not theirs — or not sent yet, or on a dossier where the
// buyer has not been disclosed — reads as one that does not exist.
export const Route = createFileRoute("/portail/contrat/$id")({
  loader: async ({ params }) => ({ contract: await getMyContractFn({ data: { id: params.id } }) }),
  head: () => ({ meta: [{ title: "Contrat | Portail fournisseur OSI" }] }),
  component: SupplierContract,
});

function SupplierContract() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { contract } = Route.useLoaderData();
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  if (!contract) {
    return (
      <section className="space-y-4">
        <Link
          to="/portail"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> {t("room.backHome")}
        </Link>
        <p className="card-surface p-6 text-sm text-muted-foreground">
          {t("portalContract.notFound")}
        </p>
      </section>
    );
  }
  const own = contract.parties.find((party) => party.you);

  const sign = async () => {
    if (busy || !agreed) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await signMyContractFn({ data: { contractId: contract.id } });
      // On success the page itself says it once reloaded: "you have signed".
      setMessage(
        result.ok ? null : { text: t(`portalContract.refusal.${result.reason}`), error: true },
      );
      await router.invalidate();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-5">
      <Link
        to="/portail/transaction/$id"
        params={{ id: contract.dealId }}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> {t("portalContract.back")}
      </Link>

      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-gold">
          {contract.number} · {t(`portalContract.status.${contract.status}`)}
        </p>
        <h1 className="mt-1 font-display text-2xl font-semibold">{contract.title}</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("portalContract.progress", { signed: contract.signed, required: contract.required })}
        </p>
      </header>

      {/* The text, as it was frozen when the contract was drafted. */}
      {contract.content && (
        <article className="card-surface space-y-4 p-6 text-sm">
          {contract.content.sections.map((section) => (
            <div key={section.heading}>
              <h2 className="font-semibold">{section.heading}</h2>
              <p className="mt-1 whitespace-pre-line text-muted-foreground">{section.body}</p>
            </div>
          ))}
        </article>
      )}

      <div className="card-surface p-5">
        <h2 className="text-sm font-semibold">{t("portalContract.parties")}</h2>
        <ul className="mt-3 divide-y divide-border text-sm">
          {contract.parties.map((party) => (
            <li
              key={`${party.role}-${party.name}`}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 py-2"
            >
              <span>
                <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">
                  {t(`contrats.role.${party.role}`)}
                  {party.you && <> · {t("portalContract.you")}</>}
                </span>
                {party.name}
              </span>
              <span
                className={cn(
                  "self-center text-xs",
                  party.signatureStatus === "signed" ? "text-success" : "text-muted-foreground",
                )}
              >
                {party.signatureStatus === "signed" && party.signedAt
                  ? t("portalContract.signedOn", {
                      when: formatDayTime(party.signedAt, i18n.language),
                    })
                  : t("portalContract.pending")}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="card-surface p-5">
        <h2 className="text-sm font-semibold">{t("portalContract.signTitle")}</h2>
        {contract.canSign && own ? (
          <>
            <p className="mt-2 text-sm text-muted-foreground">
              {t("portalContract.signIntro", { supplier: own.name })}
            </p>
            <label className="mt-3 flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
              />
              {t("portalContract.confirm", { supplier: own.name })}
            </label>
            <Button
              type="button"
              variant="gold"
              className="mt-4"
              disabled={busy || !agreed}
              onClick={() => void sign()}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <PenLine className="size-4" />}
              {t("portalContract.sign")}
            </Button>
          </>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            {/* Once they have answered, say that — not why they cannot sign
                again. */}
            {contract.yourStatus === "pending" && contract.refusal
              ? t(`portalContract.refusal.${contract.refusal}`)
              : t(`portalContract.yours.${contract.yourStatus}`)}
          </p>
        )}
        {message && (
          <p
            role={message.error ? "alert" : "status"}
            className={cn("mt-3 text-sm", message.error ? "text-destructive" : "text-success")}
          >
            {message.text}
          </p>
        )}
      </div>
    </section>
  );
}
