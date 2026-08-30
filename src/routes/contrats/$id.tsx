// The contract fiche (Phase P4 §3.2/§3.3, signatures added by P6).
//
// Everything the brief asks a contract to show — number, subject, linked
// dossier, buyer, supplier, value, incoterm, terms, dates, status — the
// parties table with each one's signature state and available action, and the
// contract's own permanent trail.
//
// Every action button is shown from a flag the SERVER resolved
// (`canSignNow`, `canRecordManualNow`, `canRemindNow`): this file never
// re-derives who may sign what, and the server fn re-checks anyway.

import { useState } from "react";
import { createFileRoute, Link, notFound, useRouter } from "@tanstack/react-router";
import { ArrowLeft, Bell, PenLine, RefreshCw, Send, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getContractEventsFn,
  getContractsFn,
  regenerateContractContentFn,
  type ContractEventView,
  type ContractView,
  type PartyView,
} from "@/lib/contract-fns";
import {
  recordManualSignatureFn,
  remindPartyFn,
  sendContractFn,
  signContractFn,
} from "@/lib/signature-fns";
import { formatDay, formatDayTime } from "@/lib/instant";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/contrats/$id")({
  loader: async ({ params }) => {
    // One query, filtered client-side: the list is small per workspace and
    // this keeps a single authorisation path rather than a second one that
    // could drift out of step with it.
    const [result, events] = await Promise.all([
      getContractsFn(),
      getContractEventsFn({ data: { contractId: params.id } }),
    ]);
    const contract = result.contracts.find((c) => c.id === params.id);
    if (!contract) throw notFound();
    return { contract, canDraft: result.canDraft, canSend: result.canSend, events };
  },
  component: ContractDetail,
});

const PARTY_STYLE: Record<string, string> = {
  pending: "border-border text-muted-foreground",
  signed: "border-success/50 text-success",
  declined: "border-destructive/50 text-destructive",
};

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-sm font-medium" title={value}>
        {value}
      </dd>
    </div>
  );
}

function ContractDetail() {
  const { t, i18n } = useTranslation();
  const { contract, canDraft, canSend, events } = Route.useLoaderData() as {
    contract: ContractView;
    canDraft: boolean;
    canSend: boolean;
    events: ContractEventView[];
  };
  const router = useRouter();
  const [redrafting, setRedrafting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  // Staff record an offline signature party by party; the PDF is optional
  // because the fact is often known before the scan arrives.
  const [manualFor, setManualFor] = useState<string | null>(null);

  const run = async (id: string, action: () => Promise<{ ok: boolean; reason?: string }>) => {
    setBusy(id);
    setRefusal(null);
    try {
      const result = await action();
      if (result.ok) await router.invalidate();
      // A refusal is data: the party needs to know WHY, not just see nothing
      // happen. The reasons come from the same pure rules the buttons used.
      else
        setRefusal(t(`contrats.refusal.${result.reason}`, { defaultValue: result.reason ?? "" }));
    } finally {
      setBusy(null);
    }
  };

  const money =
    contract.amountCents === null
      ? "—"
      : contract.currency
        ? new Intl.NumberFormat(i18n.language, {
            style: "currency",
            currency: contract.currency,
          }).format(contract.amountCents / 100)
        : (contract.amountCents / 100).toLocaleString(i18n.language);

  const date = (iso: string | null) =>
    iso ? formatDay(iso, i18n.language, "long") : t("contrats.noDue");

  return (
    <div className="space-y-6 pt-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
        <div className="min-w-0">
          {/* Breadcrumb rather than a bare back-link: on a fiche reached from
              a filtered list, "where am I" is the more useful question. */}
          <nav className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Link to="/contrats" className="transition-colors hover:text-gold">
              <ArrowLeft className="inline size-3.5" /> {t("contrats.title")}
            </Link>
            <span aria-hidden>›</span>
            <span className="font-mono text-gold">{contract.number}</span>
          </nav>
          <h1 className="mt-2 truncate font-display text-2xl font-semibold">
            <span className="font-mono text-gold">{contract.number}</span>
          </h1>
          <p className="mt-1 truncate text-sm text-muted-foreground">{contract.title}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="tabular-nums text-sm font-semibold">
            {contract.signed} / {contract.requiredSignatures}
          </span>
          <span className="rounded-full border border-border px-3 py-1 text-[11px] font-semibold">
            {t(`contrats.status.${contract.status}`)}
          </span>
          {/* A draft is an internal working copy; sending is what makes it
              signable, so this is the one action that unlocks the rest. */}
          {canSend && contract.status === "draft" && (
            <Button
              variant="gold"
              size="sm"
              disabled={busy !== null}
              onClick={() =>
                void run("send", () => sendContractFn({ data: { contractId: contract.id } }))
              }
            >
              <Send className="size-3.5" />
              {t("contrats.send")}
            </Button>
          )}
        </div>
      </header>

      <section className="card-surface p-6">
        <dl className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          <Field label={t("contrats.type.label")} value={t(`contrats.type.${contract.type}`)} />
          <Field label={t("contrats.col.value")} value={money} />
          <Field label={t("contrats.incoterm")} value={contract.incoterm ?? "—"} />
          <Field label={t("contrats.dueAt")} value={date(contract.dueAt)} />
          <Field label={t("contrats.supplier")} value={contract.supplierName} />
          <Field label={t("contrats.paymentTerms")} value={contract.paymentTerms ?? "—"} />
          <Field label={t("contrats.col.date")} value={date(contract.createdAt)} />
          <div className="min-w-0">
            <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {t("contrats.deal")}
            </dt>
            <dd className="mt-0.5 truncate text-sm font-medium">{contract.dealTitle}</dd>
          </div>
        </dl>
      </section>

      <section className="card-surface p-6">
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">
              {contract.content ? contract.content.title : t("contrats.document")}
            </h2>
            {contract.content && (
              /* The language the DOCUMENT is, not the one the reader picked:
                 what was signed is what was signed. */
              <p className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                {t("contrats.documentLocale", {
                  lang: t(`contrats.lang.${contract.content.locale}`),
                })}
              </p>
            )}
          </div>
          {/* Re-drafting is refused past `draft` on the server too — the
              button hiding is a courtesy, not the rule. */}
          {canDraft && contract.status === "draft" && (
            <Button
              variant="outline"
              size="sm"
              disabled={redrafting}
              onClick={() => {
                setRedrafting(true);
                void regenerateContractContentFn({ data: { contractId: contract.id } })
                  .then(() => router.invalidate())
                  .finally(() => setRedrafting(false));
              }}
            >
              <RefreshCw className={cn("size-3.5", redrafting && "animate-spin")} />
              {t("contrats.redraft")}
            </Button>
          )}
        </div>

        {contract.status === "draft" && (
          <p className="mt-4 rounded-lg border border-gold/40 bg-gold-soft px-4 py-2.5 text-xs text-muted-foreground">
            {t("contrats.draftNotice")}
          </p>
        )}

        {contract.content === null ? (
          <p className="mt-4 text-sm text-muted-foreground">{t("contrats.noContent")}</p>
        ) : (
          <div className="mt-5 space-y-5">
            {contract.content.sections.map((section) => (
              <article key={section.heading}>
                <h3 className="text-sm font-semibold">{section.heading}</h3>
                <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
                  {section.body}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="card-surface p-6">
        <h2 className="text-base font-semibold">{t("contrats.parties")}</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-medium">{t("contrats.partyCol.party")}</th>
                <th className="px-3 py-2 font-medium">{t("contrats.partyCol.role")}</th>
                <th className="px-3 py-2 font-medium">{t("contrats.partyCol.status")}</th>
                <th className="px-3 py-2 font-medium">{t("contrats.partyCol.signedBy")}</th>
                <th className="px-3 py-2 font-medium">{t("contrats.partyCol.signedAt")}</th>
                <th className="px-3 py-2 font-medium">{t("contrats.partyCol.action")}</th>
              </tr>
            </thead>
            <tbody>
              {contract.parties.map((party) => (
                <tr key={party.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-3">
                    <span className="block font-medium">{party.name}</span>
                    {party.email && (
                      <span className="text-[11px] text-muted-foreground">{party.email}</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-muted-foreground">
                    {t(`contrats.role.${party.role}`)}
                    {!party.required && (
                      <span className="ml-1.5 text-[11px]">({t("contrats.optional")})</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={cn(
                        "rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
                        PARTY_STYLE[party.signatureStatus],
                      )}
                    >
                      {t(`contrats.partyStatus.${party.signatureStatus}`)}
                    </span>
                  </td>
                  {/* Who actually put their name to it, and when — the two
                      facts a signature is FOR. They were buried beside the
                      status chip; the visual dossier is right that they are
                      columns. */}
                  <td className="px-3 py-3 text-muted-foreground">{party.signedByName ?? "—"}</td>
                  <td className="px-3 py-3 text-[11px] text-muted-foreground">
                    {party.signedAt ? formatDay(party.signedAt, i18n.language) : "—"}
                  </td>
                  <td className="px-3 py-3">
                    <PartyActions
                      party={party}
                      contractId={contract.id}
                      busy={busy}
                      manualOpen={manualFor === party.id}
                      onManualToggle={() => setManualFor(manualFor === party.id ? null : party.id)}
                      onSign={() =>
                        void run(party.id, () =>
                          signContractFn({
                            data: { contractId: contract.id, partyId: party.id },
                          }),
                        )
                      }
                      onRemind={() =>
                        void run(`remind:${party.id}`, () =>
                          remindPartyFn({
                            data: { contractId: contract.id, partyId: party.id },
                          }),
                        )
                      }
                      onRecorded={() => {
                        setManualFor(null);
                        void router.invalidate();
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {refusal && (
          <p role="alert" className="mt-3 text-xs text-destructive">
            {refusal}
          </p>
        )}
      </section>

      {/* The contract's OWN trail (brief §3.2). Not audit_log: the journal is
          purged at three months and signature evidence must outlive it. */}
      <section className="card-surface p-6">
        <h2 className="text-base font-semibold">{t("contrats.history")}</h2>
        {events.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">{t("contrats.noHistory")}</p>
        ) : (
          <ul className="mt-4 space-y-2.5">
            {events.map((event) => (
              <li key={event.id} className="flex items-baseline gap-3 text-xs">
                <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">
                  {formatDayTime(event.at, i18n.language, { withYear: false })}
                </span>
                <span className="min-w-0">
                  <span className="font-medium">
                    {t(`contrats.event.${event.type.replace(".", "_")}`, {
                      defaultValue: event.type,
                    })}
                  </span>
                  {event.partyName && (
                    <span className="text-muted-foreground"> — {event.partyName}</span>
                  )}
                  {event.detail?.method && (
                    <span className="text-muted-foreground">
                      {" "}
                      ({t(`contrats.method.${event.detail.method}`)})
                    </span>
                  )}
                  {event.actorName && (
                    <span className="text-muted-foreground"> · {event.actorName}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** One party's available action. Every branch is gated by a flag the server
 *  resolved — this component decides nothing. */
function PartyActions({
  party,
  contractId,
  busy,
  manualOpen,
  onManualToggle,
  onSign,
  onRemind,
  onRecorded,
}: {
  party: PartyView;
  contractId: string;
  busy: string | null;
  manualOpen: boolean;
  onManualToggle: () => void;
  onSign: () => void;
  onRemind: () => void;
  onRecorded: () => void;
}) {
  const { t } = useTranslation();

  if (party.signatureStatus === "signed") {
    return (
      <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
        {party.method ? t(`contrats.method.${party.method}`) : "—"}
        {/* Only when a document actually exists: an in-platform signature has
            no PDF to open, and a "Voir" that opens nothing is worse than none. */}
        {party.signedFileId && (
          <a
            href={`/api/files/${party.signedFileId}`}
            target="_blank"
            rel="noreferrer"
            className="text-gold hover:underline"
          >
            {t("contrats.viewSignedDoc")}
          </a>
        )}
      </span>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {party.canSignNow && (
        <Button variant="gold" size="sm" disabled={busy !== null} onClick={onSign}>
          <PenLine className="size-3.5" />
          {t("contrats.sign")}
        </Button>
      )}
      {party.canRecordManualNow && (
        <Button variant="outline" size="sm" disabled={busy !== null} onClick={onManualToggle}>
          <Upload className="size-3.5" />
          {t("contrats.recordSignature")}
        </Button>
      )}
      {party.canRemindNow && (
        <Button
          variant="ghost"
          size="sm"
          disabled={busy !== null}
          title={party.email ?? t("contrats.noEmail")}
          onClick={onRemind}
        >
          <Bell className="size-3.5" />
          {t("contrats.remind")}
        </Button>
      )}
      {!party.canSignNow && !party.canRecordManualNow && !party.canRemindNow && (
        <span className="text-[11px] text-muted-foreground">
          {t(`contrats.mechanism.${party.mechanism}`)}
        </span>
      )}
      {manualOpen && (
        <ManualSignatureForm contractId={contractId} party={party} onDone={onRecorded} />
      )}
    </div>
  );
}

/** Staff record what came back by mail: who signed, and the countersigned PDF
 *  when it has arrived. The document is OPTIONAL — the fact is often known
 *  before the scan, and blocking on the file keeps it in someone's inbox. */
function ManualSignatureForm({
  contractId,
  party,
  onDone,
}: {
  contractId: string;
  party: PartyView;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(party.name);
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      let fileId: string | undefined;
      if (file) {
        const form = new FormData();
        form.set("contractId", contractId);
        form.set("file", file);
        const response = await fetch("/api/contract-file", { method: "POST", body: form });
        if (!response.ok) {
          setError(t("contrats.uploadFailed"));
          return;
        }
        fileId = ((await response.json()) as { file: { id: string } }).file.id;
      }
      const result = await recordManualSignatureFn({
        data: {
          contractId,
          partyId: party.id,
          signedByName: name.trim(),
          ...(fileId ? { fileId } : {}),
        },
      });
      if (result.ok) onDone();
      else setError(t(`contrats.refusal.${result.reason}`, { defaultValue: result.reason }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 w-full rounded-lg border border-border bg-secondary/40 p-3">
      <p className="text-[11px] font-semibold">{t("contrats.recordTitle")}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("contrats.signatoryName")}
          className="h-8 w-[200px] text-xs"
        />
        <input
          type="file"
          accept="application/pdf,image/png,image/jpeg,image/webp"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="max-w-[220px] text-[11px] text-muted-foreground"
        />
        <Button
          variant="gold"
          size="sm"
          disabled={saving || name.trim().length < 2}
          onClick={() => void save()}
        >
          {t("contrats.recordSave")}
        </Button>
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">{t("contrats.recordHint")}</p>
      {error && (
        <p role="alert" className="mt-1.5 text-[11px] text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
