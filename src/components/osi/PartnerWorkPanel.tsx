import { useState, type FormEvent } from "react";
import { useRouter } from "@tanstack/react-router";
import { ChevronDown, ChevronRight, Loader2, Truck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDay, formatDayTime } from "@/lib/instant";
import {
  cancelPartnerCaseFn,
  getPartnerWorkFn,
  openPartnerCaseFn,
  recordEnrichmentFn,
  type PartnerCaseView,
  type PartnerWork,
} from "@/lib/partner-fns";
import { parseAmountToCents } from "@/lib/portal-rfq";

/**
 * Partners on one offer (Phase V · V22) — staff only.
 *
 * Open a case with a partner ("what does it cost to bring this supplier's
 * goods here?") and record what they answer. Loaded when opened: most offers
 * never get a case, and step 08 blocks nothing.
 *
 * The figure is recorded with ITS currency and ITS validity; the offer's
 * currency is only the default the field starts on.
 */
export function PartnerWorkPanel({
  quoteId,
  offerCurrency,
}: {
  quoteId: string;
  offerCurrency: string | null;
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [work, setWork] = useState<PartnerWork | null>(null);
  const [loading, setLoading] = useState(false);
  const [denied, setDenied] = useState(false);
  const [partnerId, setPartnerId] = useState("");
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const loaded = await getPartnerWorkFn({ data: { quoteId } });
      setDenied(loaded === null);
      setWork(loaded);
    } finally {
      setLoading(false);
    }
  };

  const toggle = () => {
    if (!open && work === null) void load();
    setOpen(!open);
  };

  const changed = async () => {
    await load();
    // The offer's card shows the figure that counts; the page's data moved.
    await router.invalidate();
  };

  const openCase = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !partnerId) return;
    setBusy(true);
    setRefusal(null);
    try {
      const result = await openPartnerCaseFn({
        data: { quoteId, partnerId, brief: brief || null },
      });
      if (!result.ok) setRefusal(result.reason);
      else {
        setPartnerId("");
        setBrief("");
      }
      await changed();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 border-t border-border pt-3">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex items-center gap-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        <Truck className="size-3.5" /> {t("partnerWork.title")}
      </button>

      {open && (
        <div className="mt-3 space-y-4">
          {loading && work === null && (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          )}
          {denied && <p className="text-xs text-muted-foreground">{t("partnerWork.denied")}</p>}

          {work && (
            <>
              {work.cases.length === 0 && (
                <p className="text-xs text-muted-foreground">{t("partnerWork.none")}</p>
              )}
              <ul className="space-y-3">
                {work.cases.map((partnerCase) => (
                  <CaseRow
                    key={partnerCase.id}
                    partnerCase={partnerCase}
                    offerCurrency={offerCurrency}
                    lang={i18n.language}
                    onChanged={changed}
                  />
                ))}
              </ul>

              {work.partners.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("partnerWork.noPartner")}</p>
              ) : (
                <form
                  className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]"
                  onSubmit={(e) => void openCase(e)}
                >
                  <select
                    value={partnerId}
                    onChange={(e) => setPartnerId(e.target.value)}
                    aria-label={t("partnerWork.choosePartner")}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    required
                  >
                    <option value="">{t("partnerWork.choosePartner")}</option>
                    {work.partners.map((partner) => (
                      <option key={partner.id} value={partner.id}>
                        {t(`partnersAdmin.kind.${partner.kind}`)} — {partner.name}
                      </option>
                    ))}
                  </select>
                  <Input
                    value={brief}
                    onChange={(e) => setBrief(e.target.value)}
                    maxLength={500}
                    placeholder={t("partnerWork.brief")}
                    aria-label={t("partnerWork.brief")}
                  />
                  <Button type="submit" size="sm" variant="outline" disabled={busy || !partnerId}>
                    {t("partnerWork.open")}
                  </Button>
                </form>
              )}
              {refusal && (
                <p role="alert" className="text-xs text-destructive">
                  {t(`partnerWork.refused.${refusal}`)}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function CaseRow({
  partnerCase,
  offerCurrency,
  lang,
  onChanged,
}: {
  partnerCase: PartnerCaseView;
  offerCurrency: string | null;
  lang: string;
  onChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const current = partnerCase.enrichments[0] ?? null;
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(current?.currency ?? offerCurrency ?? "USD");
  const [validUntil, setValidUntil] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const cancelled = partnerCase.status === "cancelled";

  const record = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const amountCents = parseAmountToCents(amount);
    if (amountCents === null) {
      setRefusal("amount");
      return;
    }
    setBusy(true);
    setRefusal(null);
    try {
      const result = await recordEnrichmentFn({
        data: {
          caseId: partnerCase.id,
          amountCents,
          currency: currency.trim(),
          validUntil: validUntil || null,
          note: note || null,
        },
      });
      if (!result.ok) setRefusal(result.reason);
      else {
        setAmount("");
        setNote("");
        setValidUntil("");
      }
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await cancelPartnerCaseFn({ data: { caseId: partnerCase.id } });
      await onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-lg border border-border p-3 text-xs">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {t(`partnersAdmin.kind.${partnerCase.kind}`)} — {partnerCase.partnerName}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {t(`partnerWork.status.${partnerCase.status}`)}
            </span>
          </p>
          {partnerCase.brief && <p className="mt-1 text-muted-foreground">{partnerCase.brief}</p>}
          {current ? (
            <p className="mt-1">
              <span className="font-semibold">
                {new Intl.NumberFormat(lang, {
                  style: "currency",
                  currency: current.currency,
                }).format(current.amountCents / 100)}
              </span>{" "}
              <span className="text-muted-foreground">
                {current.validUntil
                  ? t("partnerWork.validUntil", { date: formatDay(current.validUntil, lang) })
                  : t("partnerWork.noValidity")}
                {" · "}
                {t("partnerWork.version", {
                  version: current.version,
                  when: formatDayTime(current.createdAt, lang),
                })}
              </span>
              {current.note && <span className="block text-muted-foreground">{current.note}</span>}
            </p>
          ) : (
            !cancelled && <p className="mt-1 text-muted-foreground">{t("partnerWork.waiting")}</p>
          )}
        </div>
        {!cancelled && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void cancel()}
          >
            {t("partnerWork.cancel")}
          </Button>
        )}
      </div>

      {!cancelled && (
        <form
          className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_5rem_minmax(0,1fr)_minmax(0,1.5fr)_auto]"
          onSubmit={(e) => void record(e)}
        >
          <Input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder={t("partnerWork.amount")}
            aria-label={t("partnerWork.amount")}
            required
          />
          <Input
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            maxLength={3}
            aria-label={t("partnerWork.currency")}
            required
          />
          <Input
            type="date"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
            aria-label={t("partnerWork.validity")}
            title={t("partnerWork.validity")}
          />
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder={t("partnerWork.note")}
            aria-label={t("partnerWork.note")}
          />
          <Button type="submit" size="sm" variant="outline" disabled={busy}>
            {current ? t("partnerWork.correct") : t("partnerWork.record")}
          </Button>
        </form>
      )}
      {refusal && (
        <p role="alert" className="mt-2 text-destructive">
          {t(`partnerWork.refused.${refusal}`)}
        </p>
      )}
    </li>
  );
}
