import { useState, type FormEvent, type ReactNode } from "react";
import {
  AlertTriangle,
  Download,
  FileText,
  ListChecks,
  Loader2,
  MessageSquare,
  Upload,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DEAL_ISSUE_KINDS, type DealIssueKind } from "@/database/schema";
import type {
  DocumentView,
  DossierView,
  IssueView,
  MilestoneView,
  PartyView,
  ThreadView,
} from "@/lib/dossier";
import { PAPERWORK, milestoneState, wasLate, type MilestoneKind } from "@/lib/milestones";
import { formatCalendarDay, formatDay, formatDayTime } from "@/lib/instant";
import { cn } from "@/lib/utils";

/**
 * The Transaction Room (Phase V · V25) — one dossier, as ONE reader sees it.
 *
 * The same component for the buyer, OSI's staff, the supplier and a partner:
 * what differs between their pages is the `view` each was sent, and that was
 * decided on the server (`projectDossier`, src/lib/dossier.ts). This
 * component has no rule of its own about who may see what — it shows the
 * parties, documents and threads it receives, and names a party only when
 * the view carries its name.
 *
 * What a reader can DO is passed in by the page, which knows which server
 * functions belong to its side: `onStartThread`, `onPost`, and for the
 * workspace side `upload`.
 */
export type RoomResult = { ok: boolean; reason?: string };

export function DossierRoom({
  view,
  fileUrl,
  onStartThread,
  onPost,
  upload,
  milestones,
  issues,
  children,
}: {
  view: DossierView;
  /** Where this reader downloads a file — each side has its own route. */
  fileUrl: (fileId: string) => string;
  onStartThread: (input: {
    subject: string;
    body: string;
    parties: string[];
  }) => Promise<RoomResult>;
  onPost: (threadId: string, body: string) => Promise<RoomResult>;
  /** Set for a reader who may add documents: staff and the buyer. */
  upload?: { onDone: () => void } | undefined;
  /**
   * How this reader records a milestone (V27) — the page passes its own
   * side's functions. Left out for a reader who records none (the buyer, a
   * partner): they read the same section without the controls.
   */
  milestones?:
    | {
        onPlan: (kind: MilestoneKind, plannedAt: string | null) => Promise<RoomResult>;
        onComplete: (kind: MilestoneKind, note: string | null) => Promise<RoomResult>;
        /** Where this side posts a proof (multipart: dealId, milestone, file). */
        proofEndpoint: string;
        onDone: () => void;
      }
    | undefined;
  /**
   * How this reader raises an issue, and — staff — settles one (V28). Left
   * out for a reader who does neither.
   */
  issues?:
    | {
        onRaise: (kind: DealIssueKind, description: string) => Promise<RoomResult>;
        onSettle?: (
          issueId: string,
          status: "resolved" | "disputed",
          resolution: string,
        ) => Promise<RoomResult>;
        onDone: () => void;
      }
    | undefined;
  /** Staff's own controls (parties, disclosure), placed under the parties. */
  children?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const live = view.deal.status !== "closed" && view.deal.status !== "cancelled";
  const staff = view.audience === "staff";

  /** A party as this reader may name it. */
  const partyLabel = (party: PartyView): string => {
    if (party.name) return party.name;
    if (party.partnerKind) {
      return t("room.partnerOf", { kind: t(`partnersAdmin.kind.${party.partnerKind}`) });
    }
    return party.role === "buyer" ? t("room.buyerUndisclosed") : t(`contrats.role.${party.role}`);
  };

  return (
    <div className="space-y-5">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-gold">
          {t("room.eyebrow")} · {t(`dealBox.status.${view.deal.status}`)}
        </p>
        <h1 className="mt-1 font-display text-2xl font-semibold">{view.deal.title}</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("room.openedOn", { when: formatDay(view.deal.openedAt, lang) })}
        </p>
      </header>

      {/* ── who is on the dossier, as far as this reader is told ── */}
      <section className="card-surface p-5">
        <h2 className="text-sm font-semibold">{t("room.parties")}</h2>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {view.parties.map((party) => (
            <li key={party.id} className="rounded-lg border border-border px-3 py-2 text-sm">
              <span className="block text-[11px] uppercase tracking-wide text-muted-foreground">
                {t(`contrats.role.${party.role}`)}
                {party.you && <> · {t("room.you")}</>}
              </span>
              <span className={cn("font-medium", !party.name && "text-muted-foreground")}>
                {partyLabel(party)}
              </span>
            </li>
          ))}
        </ul>
        {view.audience === "supplier" && (
          <p className="mt-3 text-xs text-muted-foreground">
            {view.buyerDisclosedAt
              ? t("room.disclosedToYou", { when: formatDay(view.buyerDisclosedAt, lang) })
              : t("room.notDisclosedToYou")}
          </p>
        )}
        {children}
      </section>

      {/* ── what has happened, and what was meant to (V27) ── */}
      <section className="card-surface p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ListChecks className="size-4" /> {t("room.progress")}
        </h2>
        <ol className="mt-3 space-y-3">
          {view.milestones.map((milestone) => (
            <MilestoneRow
              key={milestone.kind}
              milestone={milestone}
              dealId={view.deal.id}
              staff={staff}
              fileUrl={fileUrl}
              actions={milestone.canRecord ? milestones : undefined}
            />
          ))}
        </ol>
      </section>

      {/* ── what is not as agreed (V28) — shown when there is something to
          show, or something this reader can do ── */}
      {(view.issues.length > 0 || (view.canRaiseIssue && issues)) && (
        <section className="card-surface p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="size-4" /> {t("room.issues")}
          </h2>
          {view.issues.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">{t("room.noIssue")}</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {view.issues.map((issue) => (
                <IssueRow
                  key={issue.id}
                  issue={issue}
                  staff={staff}
                  actions={view.canSettleIssues ? issues : undefined}
                />
              ))}
            </ul>
          )}
          {view.canRaiseIssue && issues && <RaiseIssue actions={issues} />}
        </section>
      )}

      {/* ── the retained offer — or, for a partner, what its work needs ── */}
      {view.offer && (
        <section className="card-surface p-5">
          <h2 className="text-sm font-semibold">{t("room.offer")}</h2>
          <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Fact
              label={t("room.fact.price")}
              value={
                view.offer.amountCents !== null && view.offer.currency
                  ? new Intl.NumberFormat(lang, {
                      style: "currency",
                      currency: view.offer.currency,
                    }).format(view.offer.amountCents / 100)
                  : null
              }
            />
            <Fact label={t("partnerHub.fact.incoterm")} value={view.offer.incoterm} />
            <Fact label={t("partnerHub.fact.quantity")} value={view.offer.quantity} />
            <Fact
              label={t("partnerHub.fact.lead_time")}
              value={
                view.offer.leadTimeDays !== null
                  ? t("portal.days", { count: view.offer.leadTimeDays })
                  : null
              }
            />
            <Fact label={t("room.fact.moq")} value={view.offer.moq} />
            <Fact label={t("room.fact.paymentTerms")} value={view.offer.paymentTerms} />
          </dl>
        </section>
      )}
      {view.facts && (
        <section className="card-surface p-5">
          <h2 className="text-sm font-semibold">{t("partnerHub.factsTitle")}</h2>
          {view.facts.goods && view.facts.goods.lines.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              {view.facts.goods.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {"quantity" in view.facts && (
              <Fact label={t("partnerHub.fact.quantity")} value={view.facts.quantity ?? null} />
            )}
            {"origin" in view.facts && (
              <Fact
                label={t("partnerHub.fact.origin")}
                value={view.facts.origin ? countryName(view.facts.origin, lang) : null}
              />
            )}
            {"incoterm" in view.facts && (
              <Fact label={t("partnerHub.fact.incoterm")} value={view.facts.incoterm ?? null} />
            )}
            {"lead_time" in view.facts && (
              <Fact
                label={t("partnerHub.fact.lead_time")}
                value={
                  view.facts.lead_time !== null && view.facts.lead_time !== undefined
                    ? t("portal.days", { count: view.facts.lead_time })
                    : null
                }
              />
            )}
            {"goods_value" in view.facts && (
              <Fact
                label={t("partnerHub.fact.goods_value")}
                value={
                  view.facts.goods_value
                    ? new Intl.NumberFormat(lang, {
                        style: "currency",
                        currency: view.facts.goods_value.currency,
                      }).format(view.facts.goods_value.amountCents / 100)
                    : null
                }
              />
            )}
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">{t("partnerHub.factsNote")}</p>
        </section>
      )}

      {/* ── documents ── */}
      <section className="card-surface p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <FileText className="size-4" /> {t("room.documents")}
        </h2>
        {view.documents.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t("room.noDocument")}</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {view.documents.map((document) => (
              <DocumentRow
                key={document.id}
                document={document}
                dealId={view.deal.id}
                fileUrl={fileUrl}
                partyLabel={partyLabel}
                staff={staff}
                upload={live ? upload : undefined}
              />
            ))}
          </ul>
        )}
        {upload && live && (
          <UploadForm
            dealId={view.deal.id}
            // Staff choose who reads it; a buyer's upload is the buyer's.
            parties={staff ? view.parties.filter((party) => party.role !== "osi") : []}
            partyLabel={partyLabel}
            onDone={upload.onDone}
          />
        )}
      </section>

      {/* ── exchanges ── */}
      <section className="card-surface p-5">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <MessageSquare className="size-4" /> {t("room.threads")}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {t(staff ? "room.threadsHintStaff" : "room.threadsHint")}
        </p>
        {view.threads.length === 0 && (
          <p className="mt-3 text-sm text-muted-foreground">{t("room.noThread")}</p>
        )}
        <ul className="mt-3 space-y-4">
          {view.threads.map((thread) => (
            <ThreadBlock
              key={thread.id}
              thread={thread}
              staff={staff}
              live={live}
              partyLabel={partyLabel}
              onPost={onPost}
            />
          ))}
        </ul>
        {live && (
          <NewThread
            // Only staff put other sides in a conversation.
            parties={staff ? view.parties.filter((party) => party.role !== "osi") : []}
            partyLabel={partyLabel}
            onStart={onStartThread}
          />
        )}
      </section>
    </div>
  );
}

const STATE_STYLE: Record<ReturnType<typeof milestoneState>, string> = {
  done: "bg-success/15 text-success",
  late: "bg-destructive/15 text-destructive",
  planned: "bg-gold-soft text-gold",
  unplanned: "bg-secondary text-muted-foreground",
};

/**
 * One milestone. WHERE it stands — done, late, planned — is worked out here,
 * at the moment the page is read (`milestoneState`): nobody marks a
 * milestone late, and nothing stored says it is.
 */
function MilestoneRow({
  milestone,
  dealId,
  staff,
  fileUrl,
  actions,
}: {
  milestone: MilestoneView;
  dealId: string;
  staff: boolean;
  fileUrl: (fileId: string) => string;
  actions:
    | {
        onPlan: (kind: MilestoneKind, plannedAt: string | null) => Promise<RoomResult>;
        onComplete: (kind: MilestoneKind, note: string | null) => Promise<RoomResult>;
        proofEndpoint: string;
        onDone: () => void;
      }
    | undefined;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const state = milestoneState(milestone, new Date());
  const [planned, setPlanned] = useState(milestone.plannedAt?.slice(0, 10) ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const recorded = milestone.plannedAt !== null || milestone.completedAt !== null;
  // What a document attached here can be (V29): a bill of lading, a packing
  // list… The first is what it is taken for unless the uploader says.
  const paperwork = PAPERWORK[milestone.kind];
  const [documentKind, setDocumentKind] = useState<string>(paperwork[0]!);

  const run = async (action: () => Promise<RoomResult>) => {
    if (busy) return;
    setBusy(true);
    setRefusal(null);
    try {
      const result = await action();
      if (!result.ok) setRefusal(result.reason ?? "not_found");
      else {
        setNote("");
        actions?.onDone();
      }
    } finally {
      setBusy(false);
    }
  };

  const attach = async (file: File | undefined) => {
    if (!file || !actions) return;
    await run(async () => {
      const form = new FormData();
      form.set("dealId", dealId);
      form.set("milestone", milestone.kind);
      form.set("documentKind", documentKind);
      form.set("file", file);
      const response = await fetch(actions.proofEndpoint, { method: "POST", body: form });
      return response.ok ? { ok: true } : { ok: false, reason: `upload_${response.status}` };
    });
  };

  return (
    <li className="rounded-lg border border-border p-3 text-sm">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <p className="font-medium">{t(`room.milestone.${milestone.kind}`)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {milestone.completedAt
              ? t("room.doneOn", { when: formatDay(milestone.completedAt, lang) })
              : milestone.plannedAt
                ? // A planned date is a calendar day, not an instant.
                  t("room.plannedFor", { when: formatCalendarDay(milestone.plannedAt, lang) })
                : t("room.notPlanned")}
            {milestone.completedAt && milestone.plannedAt && (
              <>
                {" · "}
                {t(wasLate(milestone) ? "room.wasLate" : "room.wasPlannedFor", {
                  when: formatCalendarDay(milestone.plannedAt, lang),
                })}
              </>
            )}
          </p>
          {/* Who recorded it: the side whose work it is, itself or through
              OSI. The person's name is staff's alone. */}
          {milestone.channel && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {/* A sentence per role, not a role dropped into a sentence:
                  « le inspecteur » is what interpolation gives in French. */}
              {t(`room.recordedBy.${milestone.channel}.${milestone.owner}`)}
              {staff && milestone.recordedByName ? ` — ${milestone.recordedByName}` : ""}
              {milestone.updatedAt ? ` · ${formatDayTime(milestone.updatedAt, lang)}` : ""}
            </p>
          )}
          {milestone.note && <p className="mt-1 whitespace-pre-line">{milestone.note}</p>}
          {milestone.proofs.length > 0 && (
            <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {milestone.proofs.map((proof) => (
                <li key={proof.id}>
                  <a
                    href={fileUrl(proof.fileId)}
                    className="inline-flex items-center gap-1 text-gold underline-offset-4 hover:underline"
                  >
                    <Download className="size-3" />
                    {/* Named for what it is, when it says: the buyer looks
                        for "the bill of lading", not for a file name. */}
                    {proof.kind && proof.kind !== "proof"
                      ? `${t(`room.docKind.${proof.kind}`)} — ${proof.filename}`
                      : proof.filename}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold",
            STATE_STYLE[state],
          )}
        >
          {t(`room.state.${state}`)}
        </span>
      </div>

      {actions && (
        <div className="mt-3 space-y-2 border-t border-border pt-3">
          {!milestone.completedAt && (
            <>
              <form
                className="grid grid-cols-[minmax(0,12rem)_auto] gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(() => actions.onPlan(milestone.kind, planned || null));
                }}
              >
                <Input
                  type="date"
                  value={planned}
                  onChange={(e) => setPlanned(e.target.value)}
                  aria-label={t("room.plannedDate")}
                  title={t("room.plannedDate")}
                />
                <Button type="submit" size="sm" variant="outline" disabled={busy}>
                  {t("room.plan")}
                </Button>
              </form>
              <form
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(() => actions.onComplete(milestone.kind, note.trim() || null));
                }}
              >
                <Input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={1000}
                  placeholder={t("room.milestoneNote")}
                  aria-label={t("room.milestoneNote")}
                />
                <Button type="submit" size="sm" variant="gold" disabled={busy}>
                  {busy && <Loader2 className="size-4 animate-spin" />}
                  {t("room.markDone")}
                </Button>
              </form>
            </>
          )}
          {/* A proof hangs from a milestone that exists: planned or done. */}
          {recorded && paperwork.length > 1 && (
            <select
              value={documentKind}
              onChange={(e) => setDocumentKind(e.target.value)}
              aria-label={t("room.docKindLabel")}
              className="mr-3 h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              {paperwork.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`room.docKind.${kind}`)}
                </option>
              ))}
            </select>
          )}
          {recorded && (
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-gold underline-offset-4 hover:underline">
              <Upload className="size-3.5" /> {t("room.addProof")}
              <input
                type="file"
                className="sr-only"
                accept="application/pdf,image/png,image/jpeg"
                disabled={busy}
                onChange={(e) => void attach(e.target.files?.[0])}
              />
            </label>
          )}
        </div>
      )}
      {refusal && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {t(`room.milestoneRefused.${refusal}`, t("room.milestoneRefused.other"))}
        </p>
      )}
    </li>
  );
}

const ISSUE_STYLE: Record<IssueView["status"], string> = {
  open: "bg-destructive/15 text-destructive",
  resolved: "bg-success/15 text-success",
  disputed: "bg-gold-soft text-gold",
};

type IssueActions = {
  onRaise: (kind: DealIssueKind, description: string) => Promise<RoomResult>;
  onSettle?: (
    issueId: string,
    status: "resolved" | "disputed",
    resolution: string,
  ) => Promise<RoomResult>;
  onDone: () => void;
};

function IssueRow({
  issue,
  staff,
  actions,
}: {
  issue: IssueView;
  staff: boolean;
  actions: IssueActions | undefined;
}) {
  const { t, i18n } = useTranslation();
  const [resolution, setResolution] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const settle = async (status: "resolved" | "disputed") => {
    if (busy || !actions?.onSettle || resolution.trim().length < 5) return;
    setBusy(true);
    setRefusal(null);
    try {
      const result = await actions.onSettle(issue.id, status, resolution.trim());
      if (!result.ok) setRefusal(result.reason ?? "not_found");
      else actions.onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-lg border border-border p-3 text-sm">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <p className="font-medium">{t(`room.issueKind.${issue.kind}`)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {issue.mine
              ? t("room.raisedByYou")
              : t("room.raisedBy", { party: t(`contrats.role.${issue.raisedByRole}`) })}
            {staff && issue.raisedByName ? ` — ${issue.raisedByName}` : ""}
            {" · "}
            {formatDayTime(issue.createdAt, i18n.language)}
          </p>
          <p className="mt-1 whitespace-pre-line">{issue.description}</p>
          {issue.resolution && (
            <p className="mt-2 rounded-md bg-secondary/50 px-2 py-1.5 text-xs">
              <span className="font-semibold">{t(`room.settled.${issue.status}`)}</span>
              {issue.resolvedAt ? ` · ${formatDay(issue.resolvedAt, i18n.language)}` : ""}
              <span className="mt-0.5 block whitespace-pre-line">{issue.resolution}</span>
            </p>
          )}
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold",
            ISSUE_STYLE[issue.status],
          )}
        >
          {t(`room.issueStatus.${issue.status}`)}
        </span>
      </div>
      {actions?.onSettle && issue.status === "open" && (
        <div className="mt-3 space-y-2 border-t border-border pt-3">
          <Textarea
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            maxLength={2000}
            rows={2}
            placeholder={t("room.resolution")}
            aria-label={t("room.resolution")}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy || resolution.trim().length < 5}
              onClick={() => void settle("resolved")}
            >
              {t("room.markResolved")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy || resolution.trim().length < 5}
              onClick={() => void settle("disputed")}
            >
              {t("room.markDisputed")}
            </Button>
          </div>
        </div>
      )}
      {refusal && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {t(`room.issueRefused.${refusal}`, t("room.issueRefused.other"))}
        </p>
      )}
    </li>
  );
}

function RaiseIssue({ actions }: { actions: IssueActions }) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<DealIssueKind>("nonconformity");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const raise = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setRefusal(null);
    try {
      const result = await actions.onRaise(kind, description.trim());
      if (!result.ok) setRefusal(result.reason ?? "not_found");
      else {
        setDescription("");
        actions.onDone();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="mt-4 space-y-2 border-t border-border pt-4" onSubmit={(e) => void raise(e)}>
      <p className="text-xs font-medium">{t("room.raiseIssue")}</p>
      <select
        value={kind}
        onChange={(e) => setKind(e.target.value as DealIssueKind)}
        aria-label={t("room.issueKindLabel")}
        className="h-9 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm"
      >
        {DEAL_ISSUE_KINDS.map((value) => (
          <option key={value} value={value}>
            {t(`room.issueKind.${value}`)}
          </option>
        ))}
      </select>
      <Textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        maxLength={2000}
        minLength={5}
        required
        rows={3}
        placeholder={t("room.issueDescription")}
        aria-label={t("room.issueDescription")}
      />
      {refusal && (
        <p role="alert" className="text-xs text-destructive">
          {t(`room.issueRefused.${refusal}`, t("room.issueRefused.other"))}
        </p>
      )}
      <Button type="submit" size="sm" variant="outline" disabled={busy}>
        {busy && <Loader2 className="size-4 animate-spin" />}
        {t("room.raiseIssueSubmit")}
      </Button>
    </form>
  );
}

function countryName(code: string, lang: string): string {
  try {
    return new Intl.DisplayNames([lang], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function Fact({ label, value }: { label: string; value: string | null }) {
  const { t } = useTranslation();
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 border-b border-border py-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("text-right font-medium", value === null && "text-muted-foreground")}>
        {value ?? t("partnerHub.notStated")}
      </dd>
    </div>
  );
}

function size(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} Ko`
    : `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function DocumentRow({
  document,
  dealId,
  fileUrl,
  partyLabel,
  staff,
  upload,
}: {
  document: DocumentView;
  dealId: string;
  fileUrl: (fileId: string) => string;
  partyLabel: (party: PartyView) => string;
  staff: boolean;
  upload: { onDone: () => void } | undefined;
}) {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const replace = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("dealId", dealId);
      form.set("supersedesId", document.id);
      form.set("file", file);
      const response = await fetch("/api/dossier-document", { method: "POST", body: form });
      if (!response.ok) {
        setError(t(`room.uploadRefused.${response.status}`, t("room.uploadRefused.other")));
        return;
      }
      upload?.onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-lg border border-border p-3 text-sm">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <a
            href={fileUrl(document.fileId)}
            className="inline-flex items-center gap-1.5 font-medium underline-offset-4 hover:underline"
          >
            <Download className="size-3.5 shrink-0" />
            <span className="truncate">{document.label ?? document.filename}</span>
          </a>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {document.label ? `${document.filename} · ` : ""}
            {t("room.version", { version: document.version })} · {size(document.size)} ·{" "}
            {formatDayTime(document.createdAt, i18n.language)}
            {staff && document.uploadedByName ? ` · ${document.uploadedByName}` : ""}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {document.sharedWith.length + document.alsoSharedWith > 0
              ? t("room.sharedWith", {
                  parties: [
                    ...document.sharedWith.map(partyLabel),
                    ...(document.alsoSharedWith > 0
                      ? [t("room.others", { count: document.alsoSharedWith })]
                      : []),
                  ].join(", "),
                })
              : t("room.sharedWithNobody")}
          </p>
        </div>
        {upload && (
          <label className="cursor-pointer text-xs font-medium text-gold underline-offset-4 hover:underline">
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : t("room.newVersion")}
            <input
              type="file"
              className="sr-only"
              accept="application/pdf,image/png,image/jpeg"
              disabled={busy}
              onChange={(e) => void replace(e.target.files?.[0])}
            />
          </label>
        )}
      </div>
      {/* Earlier versions stay readable, each at its own address. */}
      {document.earlier.length > 0 && (
        <ul className="mt-2 space-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
          {document.earlier.map((version) => (
            <li key={version.id}>
              <a
                href={fileUrl(version.fileId)}
                className="underline-offset-4 hover:text-foreground hover:underline"
              >
                {t("room.version", { version: version.version })} — {version.filename}
              </a>{" "}
              · {formatDayTime(version.createdAt, i18n.language)}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </li>
  );
}

function UploadForm({
  dealId,
  parties,
  partyLabel,
  onDone,
}: {
  dealId: string;
  /** The parties staff may share with. Empty for a buyer. */
  parties: PartyView[];
  partyLabel: (party: PartyView) => string;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [label, setLabel] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [shared, setShared] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file || busy) return;
    // Kept now: `currentTarget` is gone by the time the upload answers.
    const element = event.currentTarget;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("dealId", dealId);
      form.set("file", file);
      if (label.trim()) form.set("label", label.trim());
      for (const id of shared) form.append("sharedWith", id);
      const response = await fetch("/api/dossier-document", { method: "POST", body: form });
      if (!response.ok) {
        setError(t(`room.uploadRefused.${response.status}`, t("room.uploadRefused.other")));
        return;
      }
      setLabel("");
      setFile(null);
      setShared([]);
      element.reset();
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="mt-4 space-y-3 border-t border-border pt-4" onSubmit={(e) => void submit(e)}>
      <p className="text-xs font-medium">{t("room.addDocument")}</p>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={120}
          placeholder={t("room.documentLabel")}
          aria-label={t("room.documentLabel")}
        />
        <input
          type="file"
          required
          accept="application/pdf,image/png,image/jpeg"
          aria-label={t("room.file")}
          className="text-xs file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-2 file:text-xs"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>
      {parties.length > 0 ? (
        <fieldset className="text-xs">
          <legend className="text-muted-foreground">{t("room.shareWith")}</legend>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {parties.map((party) => (
              <label key={party.id} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={shared.includes(party.id)}
                  onChange={(e) =>
                    setShared((current) =>
                      e.target.checked
                        ? [...current, party.id]
                        : current.filter((id) => id !== party.id),
                    )
                  }
                />
                {partyLabel(party)}
              </label>
            ))}
          </div>
          {shared.length === 0 && (
            <p className="mt-1 text-muted-foreground">{t("room.shareWithNobodyYet")}</p>
          )}
        </fieldset>
      ) : (
        <p className="text-xs text-muted-foreground">{t("room.buyerUploadHint")}</p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" size="sm" variant="outline" disabled={busy || !file}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
        {t("room.upload")}
      </Button>
    </form>
  );
}

function ThreadBlock({
  thread,
  staff,
  live,
  partyLabel,
  onPost,
}: {
  thread: ThreadView;
  staff: boolean;
  live: boolean;
  partyLabel: (party: PartyView) => string;
  onPost: (threadId: string, body: string) => Promise<RoomResult>;
}) {
  const { t, i18n } = useTranslation();
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !body.trim()) return;
    setBusy(true);
    setRefusal(null);
    try {
      const result = await onPost(thread.id, body);
      if (!result.ok) setRefusal(result.reason ?? "not_found");
      else setBody("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-lg border border-border p-3">
      <p className="text-sm font-semibold">{thread.subject}</p>
      <p className="text-xs text-muted-foreground">
        {/* Who is in it. OSI always is; the others as this reader may name
            them — a participant not named to them is not in the list. */}
        {t("room.threadWith", {
          parties: [
            t("contrats.role.osi"),
            ...thread.parties.map(partyLabel),
            // Someone else reads this thread, and the reader is told so even
            // when it is not told who.
            ...(thread.alsoParties > 0 ? [t("room.others", { count: thread.alsoParties })] : []),
          ].join(", "),
        })}
      </p>
      <ul className="mt-3 space-y-2">
        {thread.messages.map((message) => (
          <li
            key={message.id}
            className={cn(
              "max-w-[85%] rounded-lg px-3 py-2 text-sm",
              message.mine ? "ml-auto bg-gold-soft" : "bg-secondary/60",
            )}
          >
            <p className="text-[11px] text-muted-foreground">
              {message.mine ? t("room.you") : t(`contrats.role.${message.role}`)}
              {/* The person, for staff only: every other reader is told which
                  side spoke. */}
              {staff && message.authorName ? ` — ${message.authorName}` : ""}
              {" · "}
              {formatDayTime(message.createdAt, i18n.language)}
            </p>
            <p className="mt-0.5 whitespace-pre-line">{message.body}</p>
          </li>
        ))}
      </ul>
      {live && (
        <form className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2" onSubmit={send}>
          <Input
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={4000}
            placeholder={t("room.reply")}
            aria-label={t("room.reply")}
          />
          <Button type="submit" size="sm" variant="outline" disabled={busy || !body.trim()}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {t("room.send")}
          </Button>
        </form>
      )}
      {refusal && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {t(`room.refused.${refusal}`)}
        </p>
      )}
    </li>
  );
}

function NewThread({
  parties,
  partyLabel,
  onStart,
}: {
  /** The parties staff may put in the thread. Empty for every other reader,
   *  whose thread is with OSI alone. */
  parties: PartyView[];
  partyLabel: (party: PartyView) => string;
  onStart: (input: { subject: string; body: string; parties: string[] }) => Promise<RoomResult>;
}) {
  const { t } = useTranslation();
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const staff = parties.length > 0;

  const start = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setRefusal(null);
    try {
      const result = await onStart({ subject, body, parties: chosen });
      if (!result.ok) setRefusal(result.reason ?? "not_found");
      else {
        setSubject("");
        setBody("");
        setChosen([]);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="mt-4 space-y-2 border-t border-border pt-4" onSubmit={(e) => void start(e)}>
      <p className="text-xs font-medium">{t(staff ? "room.newThreadStaff" : "room.newThread")}</p>
      {staff && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {parties.map((party) => (
            <label key={party.id} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={chosen.includes(party.id)}
                onChange={(e) =>
                  setChosen((current) =>
                    e.target.checked
                      ? [...current, party.id]
                      : current.filter((id) => id !== party.id),
                  )
                }
              />
              {partyLabel(party)}
            </label>
          ))}
        </div>
      )}
      <Input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        maxLength={160}
        minLength={2}
        required
        placeholder={t("room.subject")}
        aria-label={t("room.subject")}
      />
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        maxLength={4000}
        required
        rows={3}
        placeholder={t("room.message")}
        aria-label={t("room.message")}
      />
      {refusal && (
        <p role="alert" className="text-xs text-destructive">
          {t(`room.refused.${refusal}`)}
        </p>
      )}
      <Button
        type="submit"
        size="sm"
        variant="outline"
        disabled={busy || (staff && chosen.length === 0)}
      >
        {busy && <Loader2 className="size-4 animate-spin" />}
        {t("room.startThread")}
      </Button>
    </form>
  );
}
