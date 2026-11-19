import { useState, type FormEvent } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDay, formatDayTime } from "@/lib/instant";
import { answerHubCaseFn, getHubCaseFn, type HubCaseDetail } from "@/lib/partner-portal-fns";
import { parseAmountToCents, parseUnits } from "@/lib/portal-rfq";

// One case in the Partner Hub (Phase V · V23): what OSI asks, what answering
// it takes, and the partner's own figure.
//
// The page shows the facts it RECEIVES and has no opinion on which ones a
// kind of case should have: that is decided on the server
// (`factsForCase`, src/lib/partner-need.ts), and a fact a kind does not need
// is not in `facts` at all. A case that is not the caller's reads as one
// that does not exist.
export const Route = createFileRoute("/partenaires/dossier/$id")({
  loader: async ({ params }) => ({ item: await getHubCaseFn({ data: { id: params.id } }) }),
  head: () => ({ meta: [{ title: "Dossier | Partner Hub OSI" }] }),
  component: HubCase,
});

function money(amountCents: number, currency: string, lang: string): string {
  return new Intl.NumberFormat(lang, { style: "currency", currency }).format(amountCents / 100);
}

function countryName(code: string, lang: string): string {
  try {
    return new Intl.DisplayNames([lang], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

function HubCase() {
  const { t, i18n } = useTranslation();
  const { item } = Route.useLoaderData();
  const lang = i18n.language;

  const back = (
    <Link
      to="/partenaires"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" /> {t("partnerHub.back")}
    </Link>
  );

  if (!item) {
    return (
      <section className="space-y-4">
        {back}
        <p className="card-surface p-6 text-sm text-muted-foreground">{t("partnerHub.notFound")}</p>
      </section>
    );
  }

  const { facts } = item;
  // Only what was sent: each row exists when its key does.
  const rows: Array<{ label: string; value: string }> = [];
  const absent = t("partnerHub.notStated");
  if ("quantity" in facts) {
    rows.push({ label: t("partnerHub.fact.quantity"), value: facts.quantity ?? absent });
  }
  if ("origin" in facts) {
    rows.push({
      label: t("partnerHub.fact.origin"),
      value: facts.origin ? countryName(facts.origin, lang) : absent,
    });
  }
  if ("incoterm" in facts) {
    rows.push({ label: t("partnerHub.fact.incoterm"), value: facts.incoterm ?? absent });
  }
  if ("lead_time" in facts) {
    rows.push({
      label: t("partnerHub.fact.lead_time"),
      value:
        facts.lead_time !== null && facts.lead_time !== undefined
          ? t("portal.days", { count: facts.lead_time })
          : absent,
    });
  }
  if ("goods_value" in facts) {
    rows.push({
      label: t("partnerHub.fact.goods_value"),
      value: facts.goods_value
        ? money(facts.goods_value.amountCents, facts.goods_value.currency, lang)
        : absent,
    });
  }
  if ("supplier_identity" in facts) {
    rows.push({
      label: t("partnerHub.fact.supplier_identity"),
      value: facts.supplier_identity ?? absent,
    });
  }

  return (
    <section className="space-y-5">
      {back}
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-gold">
          {t(`partnersAdmin.kind.${item.kind}`)} ·{" "}
          {t("partnerHub.reference", { reference: item.reference })}
        </p>
        <h1 className="mt-1 font-display text-xl font-semibold">{item.title}</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("partnerHub.addressedTo", { partner: item.partnerName })} ·{" "}
          {t("partnerHub.openedOn", { when: formatDay(item.openedAt, lang) })} ·{" "}
          {t(`partnerHub.status.${item.status}`)}
        </p>
      </header>

      {item.status === "cancelled" && (
        <p className="card-surface border-warning/40 p-4 text-sm text-muted-foreground">
          {t("partnerHub.cancelledNote")}
        </p>
      )}

      {item.brief && (
        <div className="card-surface p-5">
          <h2 className="text-sm font-semibold">{t("partnerHub.briefTitle")}</h2>
          <p className="mt-2 whitespace-pre-line text-sm">{item.brief}</p>
        </div>
      )}

      <div className="card-surface p-5">
        <h2 className="text-sm font-semibold">{t("partnerHub.factsTitle")}</h2>
        {facts.goods && facts.goods.lines.length > 0 && (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {facts.goods.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
        {rows.length > 0 && (
          <dl className="mt-3 divide-y divide-border text-sm">
            {rows.map((row) => (
              <div
                key={row.label}
                className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-4 py-1.5"
              >
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className="text-right font-medium">{row.value}</dd>
              </div>
            ))}
          </dl>
        )}
        <p className="mt-3 text-xs text-muted-foreground">{t("partnerHub.factsNote")}</p>
      </div>

      <div className="card-surface p-5">
        <h2 className="text-sm font-semibold">{t("partnerHub.answerTitle")}</h2>
        {item.figures.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">{t("partnerHub.noFigure")}</p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm">
            {item.figures.map((figure, index) => (
              <li
                key={figure.version}
                className={index === 0 ? "" : "text-muted-foreground line-through"}
              >
                <span className="font-semibold">
                  {money(figure.amountCents, figure.currency, lang)}
                </span>{" "}
                <span className="text-xs text-muted-foreground no-underline">
                  {figure.units
                    ? t("partnerWork.forUnits", { units: figure.units.toLocaleString(lang) })
                    : t("partnerWork.noUnits")}
                  {" · "}
                  {figure.validUntil
                    ? t("partnerWork.validUntil", { date: formatDay(figure.validUntil, lang) })
                    : t("partnerWork.noValidity")}
                  {" · "}
                  {t(`partnerHub.channel.${figure.channel}`)}
                  {" · "}
                  {formatDayTime(figure.createdAt, lang)}
                </span>
                {figure.note && (
                  <span className="block text-xs text-muted-foreground">{figure.note}</span>
                )}
              </li>
            ))}
          </ul>
        )}
        {item.canAnswer && <AnswerForm item={item} />}
      </div>
    </section>
  );
}

function AnswerForm({ item }: { item: HubCaseDetail }) {
  const { t } = useTranslation();
  const router = useRouter();
  const current = item.figures[0] ?? null;
  const [amount, setAmount] = useState("");
  // The currency THEY quote in. It starts on their last figure's, else on the
  // goods' when the case shows it — a starting point, never a conversion.
  const [currency, setCurrency] = useState(
    current?.currency ?? item.facts.goods_value?.currency ?? "USD",
  );
  const [validUntil, setValidUntil] = useState("");
  const [units, setUnits] = useState(current?.units ? String(current.units) : "");
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setSaved(false);
    const amountCents = parseAmountToCents(amount);
    if (amountCents === null) {
      setRefusal("amount");
      return;
    }
    const covered = parseUnits(units);
    if (covered === "invalid") {
      setRefusal("units");
      return;
    }
    setPending(true);
    setRefusal(null);
    try {
      const result = await answerHubCaseFn({
        data: {
          caseId: item.id,
          amountCents,
          currency: currency.trim(),
          validUntil: validUntil || null,
          units: covered,
          note: note || null,
        },
      });
      if (!result.ok) setRefusal(result.reason);
      else {
        setAmount("");
        setNote("");
        setValidUntil("");
        setSaved(true);
      }
      await router.invalidate();
    } finally {
      setPending(false);
    }
  };

  const label = "mb-1 block text-xs font-medium text-muted-foreground";
  return (
    <form className="mt-4 space-y-3 border-t border-border pt-4" onSubmit={(e) => void submit(e)}>
      <p className="text-xs text-muted-foreground">
        {current ? t("partnerHub.correctHint") : t("partnerHub.answerHint")}
      </p>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_6rem_minmax(0,1fr)]">
        <div>
          <label htmlFor="hub-amount" className={label}>
            {t("partnerWork.amount")} *
          </label>
          <Input
            id="hub-amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            required
          />
        </div>
        <div>
          <label htmlFor="hub-currency" className={label}>
            {t("partnerWork.currency")} *
          </label>
          <Input
            id="hub-currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            maxLength={3}
            required
          />
        </div>
        <div>
          <label htmlFor="hub-validity" className={label}>
            {t("partnerWork.validity")}
          </label>
          <Input
            id="hub-validity"
            type="date"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
          />
        </div>
      </div>
      <div>
        <label htmlFor="hub-units" className={label}>
          {t("partnerHub.units")}
        </label>
        <Input
          id="hub-units"
          value={units}
          onChange={(e) => setUnits(e.target.value)}
          inputMode="decimal"
          className="sm:max-w-xs"
        />
        <p className="mt-1 text-xs text-muted-foreground">{t("partnerHub.unitsHint")}</p>
      </div>
      <div>
        <label htmlFor="hub-note" className={label}>
          {t("partnerHub.note")}
        </label>
        <Input
          id="hub-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
        />
      </div>
      {refusal && (
        <p role="alert" className="text-sm text-destructive">
          {t(`partnerHub.refused.${refusal}`)}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm text-success">
          {t("partnerHub.saved")}
        </p>
      )}
      <Button type="submit" variant="gold" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        {current ? t("partnerHub.correct") : t("partnerHub.send")}
      </Button>
    </form>
  );
}
