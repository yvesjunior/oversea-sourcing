import { useRef, useState, type FormEvent } from "react";
import { createFileRoute, Link, notFound, useRouter } from "@tanstack/react-router";
import { ArrowLeft, FileText, Loader2, Paperclip } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { declineRfqFn, getRfqFn, submitOfferFn, type PortalRfqDetail } from "@/lib/portal-fns";
import { parseAmountToCents } from "@/lib/portal-rfq";
import { formatDeadline } from "@/lib/rfq-mail";

// One RFQ, for the supplier it was sent to (Phase V · V16): what is asked,
// until when, and the form to answer — the same figures the RFQ email lists.
//
// The loader's `null` means "not one of yours OR no such RFQ"; both are a
// plain not-found. The page shows nothing about the buyer, the other
// suppliers or the state of the round beyond open / closed.
export const Route = createFileRoute("/portail/rfq/$id")({
  loader: async ({ params }) => {
    const rfq = await getRfqFn({ data: { id: params.id } });
    if (!rfq) throw notFound();
    return { rfq };
  },
  head: () => ({ meta: [{ title: "Appel d'offres | OSI" }] }),
  component: PortalRfq,
});

const label = "mb-1 block text-xs font-medium text-muted-foreground";

function PortalRfq() {
  const { t, i18n } = useTranslation();
  const { rfq } = Route.useLoaderData();
  const locale = i18n.language === "en" ? "en" : "fr";

  return (
    <div className="space-y-5">
      <Link
        to="/portail"
        className="flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> {t("portal.back")}
      </Link>

      <header className="card-surface p-6">
        <p className="text-xs text-muted-foreground">
          {t("portal.reference", { id: rfq.reference })} · {rfq.supplierName}
        </p>
        <h1 className="mt-1 font-display text-xl font-semibold">{rfq.title}</h1>
        <p className="mt-2 text-sm">
          <span className="font-medium">{t(`portal.state.${rfq.state}`)}</span>
          {" · "}
          <span className="text-muted-foreground">
            {t("portal.deadline", { when: formatDeadline(new Date(rfq.closesAt), locale) })}
          </span>
        </p>
      </header>

      <section className="card-surface space-y-4 p-6">
        <h2 className="text-sm font-semibold">{t("portal.specTitle")}</h2>
        {rfq.spec.criteria.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {rfq.spec.criteria.map((criterion) => (
              <li key={criterion.line}>
                {criterion.line}
                {criterion.required && (
                  <span className="ml-2 text-[11px] font-semibold text-gold">
                    {t("portal.required")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {rfq.spec.description && (
          <div>
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t("portal.clientDescription")}
            </h3>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">
              {rfq.spec.description}
            </p>
          </div>
        )}
      </section>

      {/* Remounted when the offer changes on the server, so the form always
          starts from what is recorded. */}
      <OfferSection key={`${rfq.state}:${rfq.offer?.amountCents ?? ""}`} rfq={rfq} />
      <DocumentsSection rfq={rfq} />
      {rfq.canDecline && <DeclineSection rfq={rfq} />}
    </div>
  );
}

function OfferSection({ rfq }: { rfq: PortalRfqDetail }) {
  const { t } = useTranslation();
  const router = useRouter();
  const offer = rfq.offer;
  const [amount, setAmount] = useState(
    offer?.amountCents != null ? (offer.amountCents / 100).toFixed(2) : "",
  );
  const [currency, setCurrency] = useState(offer?.currency ?? "USD");
  const [quantity, setQuantity] = useState(offer?.quantity ?? "");
  const [moq, setMoq] = useState(offer?.moq ?? "");
  const [leadTime, setLeadTime] = useState(
    offer?.leadTimeDays != null ? String(offer.leadTimeDays) : "",
  );
  const [incoterm, setIncoterm] = useState(offer?.incoterm ?? "");
  const [paymentTerms, setPaymentTerms] = useState(offer?.paymentTerms ?? "");
  const [validUntil, setValidUntil] = useState(offer?.validUntil?.slice(0, 10) ?? "");
  const [notes, setNotes] = useState(offer?.notes ?? "");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "done"; key: string } | null>(null);

  // After the window closes the form is read-only, and says so.
  if (!rfq.canSubmit) {
    return (
      <section className="card-surface space-y-3 p-6">
        <h2 className="text-sm font-semibold">{t("portal.offerTitle")}</h2>
        <p className="text-sm text-muted-foreground">
          {offer ? t("portal.closedWithOffer") : t(`portal.closedWithout.${rfq.state}`)}
        </p>
        {offer && (
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Fact term={t("portal.field.price")}>
              {offer.amountCents != null
                ? `${(offer.amountCents / 100).toFixed(2)} ${offer.currency ?? ""}`
                : "—"}
            </Fact>
            <Fact term={t("portal.field.leadTime")}>
              {offer.leadTimeDays != null ? t("portal.days", { count: offer.leadTimeDays }) : "—"}
            </Fact>
            <Fact term={t("portal.field.quantity")}>{offer.quantity ?? "—"}</Fact>
            <Fact term={t("portal.field.moq")}>{offer.moq ?? "—"}</Fact>
            <Fact term={t("portal.field.incoterm")}>{offer.incoterm ?? "—"}</Fact>
            <Fact term={t("portal.field.paymentTerms")}>{offer.paymentTerms ?? "—"}</Fact>
            <Fact term={t("portal.field.validUntil")}>{offer.validUntil?.slice(0, 10) ?? "—"}</Fact>
          </dl>
        )}
      </section>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    const amountCents = parseAmountToCents(amount);
    if (amountCents === null || amountCents <= 0) {
      setMessage({ kind: "error", key: "portal.error.amount" });
      return;
    }
    const days = leadTime.trim() === "" ? null : Number(leadTime);
    if (days !== null && (!Number.isInteger(days) || days < 0 || days > 3650)) {
      setMessage({ kind: "error", key: "portal.error.leadTime" });
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const result = await submitOfferFn({
        data: {
          id: rfq.id,
          amountCents,
          currency: currency.trim(),
          quantity: quantity || null,
          moq: moq || null,
          leadTimeDays: days,
          incoterm: incoterm || null,
          paymentTerms: paymentTerms || null,
          notes: notes || null,
          validUntil: validUntil || null,
        },
      });
      setMessage(
        result.ok
          ? { kind: "done", key: offer ? "portal.offerUpdated" : "portal.offerSent" }
          : { kind: "error", key: `portal.error.${result.reason}` },
      );
      await router.invalidate();
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="card-surface p-6">
      <h2 className="text-sm font-semibold">{t("portal.offerTitle")}</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        {offer ? t("portal.offerEditHint") : t("portal.offerHint")}
      </p>
      <form className="mt-4 space-y-4" onSubmit={(e) => void submit(e)}>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div>
            <label htmlFor="offer-amount" className={label}>
              {t("portal.field.price")} *
            </label>
            <Input
              id="offer-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              required
            />
          </div>
          <div>
            <label htmlFor="offer-currency" className={label}>
              {t("portal.field.currency")} *
            </label>
            <Input
              id="offer-currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              maxLength={3}
              pattern="[A-Za-z]{3}"
              required
            />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="offer-quantity" className={label}>
              {t("portal.field.quantity")}
            </label>
            <Input
              id="offer-quantity"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              maxLength={80}
            />
          </div>
          <div>
            <label htmlFor="offer-moq" className={label}>
              {t("portal.field.moq")}
            </label>
            <Input
              id="offer-moq"
              value={moq}
              onChange={(e) => setMoq(e.target.value)}
              maxLength={80}
            />
          </div>
          <div>
            <label htmlFor="offer-lead" className={label}>
              {t("portal.field.leadTime")}
            </label>
            <Input
              id="offer-lead"
              inputMode="numeric"
              value={leadTime}
              onChange={(e) => setLeadTime(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="offer-incoterm" className={label}>
              {t("portal.field.incoterm")}
            </label>
            <Input
              id="offer-incoterm"
              value={incoterm}
              onChange={(e) => setIncoterm(e.target.value)}
              maxLength={20}
              placeholder="FOB Shanghai"
            />
          </div>
          <div>
            <label htmlFor="offer-payment" className={label}>
              {t("portal.field.paymentTerms")}
            </label>
            <Input
              id="offer-payment"
              value={paymentTerms}
              onChange={(e) => setPaymentTerms(e.target.value)}
              maxLength={200}
            />
          </div>
          <div>
            <label htmlFor="offer-valid" className={label}>
              {t("portal.field.validUntil")}
            </label>
            <Input
              id="offer-valid"
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">{t("portal.validHint")}</p>
          </div>
        </div>
        <div>
          <label htmlFor="offer-notes" className={label}>
            {t("portal.field.notes")}
          </label>
          <Textarea
            id="offer-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={2000}
            rows={3}
          />
        </div>

        {message && (
          <p
            role={message.kind === "error" ? "alert" : "status"}
            className={
              message.kind === "error" ? "text-sm text-destructive" : "text-sm text-success"
            }
          >
            {t(message.key)}
          </p>
        )}

        <Button type="submit" variant="gold" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          {offer ? t("portal.updateOffer") : t("portal.sendOffer")}
        </Button>
      </form>
    </section>
  );
}

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{term}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

function DocumentsSection({ rfq }: { rfq: PortalRfqDetail }) {
  const { t } = useTranslation();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Nothing to show and nothing to add: no section at all.
  if (rfq.documents.length === 0 && !rfq.canSubmit) return null;

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0 || uploading) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("quoteId", rfq.id);
      for (const file of Array.from(files)) form.append("files", file);
      const response = await fetch("/api/portal/quote-document", { method: "POST", body: form });
      if (!response.ok) {
        setError(
          response.status === 413 || response.status === 415
            ? `portal.error.upload_${response.status}`
            : "portal.error.upload",
        );
      }
      await router.invalidate();
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <section className="card-surface space-y-3 p-6">
      <h2 className="text-sm font-semibold">{t("portal.documentsTitle")}</h2>
      {rfq.documents.length > 0 && (
        <ul className="space-y-1.5 text-sm">
          {rfq.documents.map((document) => (
            <li key={document.id}>
              <a
                href={`/api/portal/file/${document.fileId}`}
                className="inline-flex items-center gap-2 text-gold underline-offset-4 hover:underline"
              >
                <FileText className="size-4 shrink-0" /> {document.filename}
              </a>
            </li>
          ))}
        </ul>
      )}
      {rfq.canSubmit && (
        <>
          <input
            ref={input}
            type="file"
            multiple
            accept=".pdf,.png,.jpg,.jpeg"
            className="hidden"
            onChange={(e) => void upload(e.target.files)}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => input.current?.click()}
          >
            {uploading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Paperclip className="size-4" />
            )}
            {t("portal.attach")}
          </Button>
          <p className="text-xs text-muted-foreground">{t("portal.attachHint")}</p>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t(error)}
        </p>
      )}
    </section>
  );
}

function DeclineSection({ rfq }: { rfq: PortalRfqDetail }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decline = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await declineRfqFn({ data: { id: rfq.id, note: note || null } });
      if (!result.ok) setError(`portal.error.${result.reason}`);
      await router.invalidate();
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="card-surface space-y-3 p-6">
      <h2 className="text-sm font-semibold">{t("portal.declineTitle")}</h2>
      <p className="text-sm text-muted-foreground">{t("portal.declineText")}</p>
      {!open ? (
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          {t("portal.declineOpen")}
        </Button>
      ) : (
        <div className="space-y-3">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
            rows={2}
            placeholder={t("portal.declineNote")}
            aria-label={t("portal.declineNote")}
          />
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => void decline()}
            >
              {pending && <Loader2 className="size-4 animate-spin" />}
              {t("portal.declineConfirm")}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              {t("portal.cancel")}
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t(error)}
        </p>
      )}
    </section>
  );
}
