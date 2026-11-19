// The Decision Pack and what staff can do with it (Phase V · V10, V11).
//
// What the buyer WILL be shown once the pack is released: which offers, in
// which order, with the figures as the pack holds them (a frozen copy, not
// the live quote). While it is pending it follows the round.
//
// And the four powers (owner, 2026-10-25), each costing something different:
//   • approve  — send it as built;
//   • correct  — change the order or withhold offers, WITH A REASON, and send;
//   • relaunch — ask more suppliers; the pack waits for the new round;
//   • refuse   — send nothing; the buyer is told why.
// Releasing is the irreversible one, so the two that release say so on their
// button, and the reasons are not optional: they are what lets anyone ask
// later whether the review changed what the buyer saw.

import { useState, type FormEvent } from "react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Ban,
  Check,
  PackageOpen,
  Pencil,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatDayTime, formatInstant } from "@/lib/instant";
import {
  approvePackFn,
  assignPackFn,
  correctPackFn,
  refusePackFn,
  relaunchPackFn,
  setPackFxRateFn,
  type PackEventView,
  type PackItemView,
  type RequestPackView,
} from "@/lib/pack-fns";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<string, string> = {
  pending: "border-gold/50 bg-gold-soft text-gold",
  released: "border-success/50 text-success",
  refused: "border-border text-muted-foreground",
  withdrawn: "border-border text-muted-foreground",
};

function money(cents: number | null, currency: string | null, lang: string): string {
  if (cents === null) return "—";
  const value = cents / 100;
  // In the currency it was quoted in — never converted (ADR-002).
  return currency
    ? new Intl.NumberFormat(lang, { style: "currency", currency }).format(value)
    : value.toLocaleString(lang);
}

function OfferLine({ item }: { item: PackItemView }) {
  const { t, i18n } = useTranslation();
  const { offer } = item;
  return (
    <span className="block text-xs text-muted-foreground">
      {[
        money(offer.amountCents, offer.currency, i18n.language),
        offer.leadTimeDays !== null ? t("ranking.days", { count: offer.leadTimeDays }) : null,
        offer.incoterm,
        offer.paymentTerms,
        offer.validUntil
          ? t("ranking.validUntil", {
              date: formatInstant(offer.validUntil, i18n.language, {
                day: "numeric",
                month: "short",
                year: "numeric",
              }),
            })
          : null,
      ]
        .filter(Boolean)
        .join(" · ")}
    </span>
  );
}

function ItemRow({ item }: { item: PackItemView }) {
  const { t } = useTranslation();
  const { offer } = item;
  const withheld = item.rank === null;
  const moved = !withheld && item.rankComputed !== undefined && item.rankComputed !== item.rank;
  return (
    <li
      className={cn(
        "grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-3 rounded-lg border p-3",
        withheld ? "border-dashed border-border opacity-70" : "border-border",
      )}
    >
      <span className="text-sm font-semibold tabular-nums text-muted-foreground">
        {withheld ? "—" : `#${item.rank}`}
      </span>
      <div className="min-w-0">
        <span className="block truncate text-sm font-semibold">{offer.supplierName}</span>
        <OfferLine item={item} />
        {/* The computed place beside the shown one — never sent to the buyer. */}
        {withheld && (
          <span className="block text-[11px] text-warning">
            {t("pack.withheld", { rank: item.rankComputed })}
          </span>
        )}
        {moved && (
          <span className="block text-[11px] text-warning">
            {t("pack.movedFrom", { rank: item.rankComputed })}
          </span>
        )}
      </div>
      {offer.channel && (
        <span
          title={t(`soumissions.channelHint.${offer.channel}`)}
          className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {t(`soumissions.channel.${offer.channel}`)}
        </span>
      )}
    </li>
  );
}

/**
 * The exchange rates stored on a pack (V24). Decision D7: no amount is
 * converted on a rate nobody stored — this is where a staff member stores
 * one, with where the number comes from and the day it is of. Storing or
 * removing one recomputes the ranking.
 */
function FxRates({
  pack,
  editable,
  onChanged,
}: {
  pack: RequestPackView["pack"];
  editable: boolean;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rate, setRate] = useState("");
  const [source, setSource] = useState("");
  const [asOf, setAsOf] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const send = async (
    input: { from: string; to: string; rate: number | null; source: string; asOf: string },
    done: string,
  ) => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await setPackFxRateFn({ data: { packId: pack.id, ...input } });
      if (!result.ok) {
        setMessage({ text: t(`pack.refusal.${result.reason}`), error: true });
        return;
      }
      setMessage({ text: done, error: false });
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const add = (event: FormEvent) => {
    event.preventDefault();
    const value = Number(rate.replace(/\s/g, "").replace(",", "."));
    const valid =
      /^[A-Za-z]{3}$/.test(from.trim()) &&
      /^[A-Za-z]{3}$/.test(to.trim()) &&
      Number.isFinite(value) &&
      value > 0 &&
      source.trim().length >= 2 &&
      /^\d{4}-\d{2}-\d{2}$/.test(asOf);
    if (!valid) {
      setMessage({ text: t("pack.rates.invalid"), error: true });
      return;
    }
    void send({ from, to, rate: value, source, asOf }, t("pack.rates.done")).then(() => {
      setRate("");
    });
  };

  return (
    <div className="mt-4 border-t border-border pt-4 text-xs">
      <p className="font-semibold">{t("pack.rates.title")}</p>
      <p className="mt-1 text-muted-foreground">{t("pack.rates.intro")}</p>
      {pack.fxRates.length === 0 ? (
        <p className="mt-2 text-muted-foreground">{t("pack.rates.none")}</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {pack.fxRates.map((stored) => (
            <li
              key={`${stored.from}-${stored.to}`}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3"
            >
              <span>
                {t("packView.rateLine", {
                  from: stored.from,
                  to: stored.to,
                  rate: stored.rate,
                  source: stored.source,
                  asOf: stored.asOf,
                })}
              </span>
              {editable && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => void send({ ...stored, rate: null }, t("pack.rates.removed"))}
                >
                  {t("pack.rates.remove")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <form
          className="mt-3 grid gap-2 sm:grid-cols-[4.5rem_4.5rem_6rem_minmax(0,1fr)_9rem_auto]"
          onSubmit={add}
        >
          <Input
            value={from}
            onChange={(e) => setFrom(e.target.value.toUpperCase())}
            maxLength={3}
            placeholder={t("pack.rates.from")}
            aria-label={t("pack.rates.from")}
          />
          <Input
            value={to}
            onChange={(e) => setTo(e.target.value.toUpperCase())}
            maxLength={3}
            placeholder={t("pack.rates.to")}
            aria-label={t("pack.rates.to")}
          />
          <Input
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            inputMode="decimal"
            placeholder={t("pack.rates.rate")}
            aria-label={t("pack.rates.rate")}
          />
          <Input
            value={source}
            onChange={(e) => setSource(e.target.value)}
            maxLength={120}
            placeholder={t("pack.rates.source")}
            aria-label={t("pack.rates.source")}
          />
          <Input
            type="date"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
            aria-label={t("pack.rates.asOf")}
            title={t("pack.rates.asOf")}
          />
          <Button type="submit" size="sm" variant="outline" disabled={busy}>
            {t("pack.rates.add")}
          </Button>
        </form>
      )}
      {message && (
        <p
          role={message.error ? "alert" : "status"}
          className={cn("mt-2", message.error ? "text-destructive" : "text-muted-foreground")}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}

function EventLine({ event }: { event: PackEventView }) {
  const { t, i18n } = useTranslation();
  return (
    <li className="text-xs">
      <p>
        <span className="font-semibold">{t(`pack.event.${event.action}`)}</span>
        <span className="text-muted-foreground">
          {" — "}
          {event.actorName ?? t("pack.bySystem")}, {formatDayTime(event.at, i18n.language)}
        </span>
      </p>
      {event.action === "assigned" && (
        <p className="text-muted-foreground">
          {event.toName ? t("pack.assignedTo", { name: event.toName }) : t("pack.putBack")}
        </p>
      )}
      {event.note && <p className="mt-0.5 whitespace-pre-wrap">« {event.note} »</p>}
      {event.moves.length > 0 && (
        <p className="mt-0.5 text-muted-foreground">
          {event.moves
            .map((move) =>
              move.to === null
                ? t("pack.moveWithheld", { supplier: move.supplier ?? "—", from: move.from })
                : t("pack.move", { supplier: move.supplier ?? "—", from: move.from, to: move.to }),
            )
            .join(" · ")}
        </p>
      )}
      {event.suppliers.length > 0 && (
        <p className="mt-0.5 text-muted-foreground">
          {event.round !== null ? `${t("pack.round", { no: event.round })} : ` : ""}
          {event.suppliers
            .map((supplier) =>
              supplier.was
                ? `${supplier.name} (${t(`pack.candidate.${supplier.was}`)})`
                : supplier.name,
            )
            .join(" · ")}
        </p>
      )}
    </li>
  );
}

type Mode = null | "correct" | "relaunch" | "refuse";

export function DecisionPackPanel({
  data,
  me,
  onChanged,
}: {
  data: RequestPackView;
  /** The staff member looking at it — to offer "take" or "put back". */
  me: string | null;
  onChanged: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { pack, offersInRound, targetOffers, canAct } = data;
  const shown = pack.items.filter((item) => item.rank !== null);
  const left = offersInRound - pack.items.length;

  const [mode, setMode] = useState<Mode>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [note, setNote] = useState("");
  // Correct: the working order (quote ids, best first) and what is withheld.
  const [order, setOrder] = useState<string[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  // Relaunch: who to ask.
  const [picked, setPicked] = useState<string[]>([]);

  const open = (next: Mode) => {
    setMessage(null);
    setNote("");
    setOrder(shown.map((item) => item.quoteId).filter((id): id is string => id !== null));
    setRemoved([]);
    setPicked([]);
    setMode(next);
  };

  const run = async (
    action: () => Promise<{ ok: boolean; reason?: string; suppliers?: string[] | undefined }>,
    done: string,
  ) => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await action();
      if (!result.ok) {
        const named = result.suppliers?.length ? ` (${result.suppliers.join(", ")})` : "";
        setMessage({
          text: t(`pack.refusal.${result.reason ?? "not_pending"}`) + named,
          error: true,
        });
        return;
      }
      setMode(null);
      setMessage({ text: done, error: false });
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  const move = (id: string, delta: number) => {
    const index = order.indexOf(id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target] as string, next[index] as string];
    setOrder(next);
  };
  const toggleRemoved = (id: string) => {
    if (removed.includes(id)) {
      setRemoved(removed.filter((other) => other !== id));
      setOrder([...order, id]);
    } else {
      setRemoved([...removed, id]);
      setOrder(order.filter((other) => other !== id));
    }
  };
  const itemOf = (id: string) => pack.items.find((item) => item.quoteId === id);
  const noteMissing = note.trim() === "";
  const mine = me !== null && pack.internal?.assignedTo === me;

  return (
    <section className="card-surface p-6">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <PackageOpen className="size-4 text-muted-foreground" />
            {t("pack.title")}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">{t(`pack.subtitle.${pack.status}`)}</p>
        </div>
        <span
          className={cn(
            "rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
            STATUS_STYLE[pack.status],
          )}
        >
          {t(`pack.status.${pack.status}`)}
        </span>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        {t("pack.built", { date: formatDayTime(pack.builtAt, i18n.language) })}
        {pack.internal && (
          <>
            {" · "}
            {t("pack.mode", {
              mode: t(`platformSettings.options.${pack.internal.releaseMode}`).toLowerCase(),
            })}
          </>
        )}
        {pack.releasedAt && (
          <>
            {" · "}
            {t("pack.releasedOn", {
              date: formatDayTime(pack.releasedAt, i18n.language),
              name: pack.internal?.releasedByName ?? t("pack.bySystem"),
            })}
          </>
        )}
      </p>
      {pack.status === "pending" && pack.internal?.releaseMode === "automatic" && (
        // An automatic pack still pending did NOT leave at its close — and
        // will not leave by itself any more. Said, so nobody waits for it.
        <p className="mt-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">
          {t("pack.autoHeld")}
        </p>
      )}
      {pack.internal?.refusedReason && (
        <p className="mt-2 rounded-lg bg-secondary/40 px-3 py-2 text-xs">
          <span className="font-semibold">{t("pack.refusedBecause")}</span>{" "}
          {pack.internal.refusedReason}
        </p>
      )}

      {/* Whose desk it is on — an unassigned pack must LOOK unassigned. */}
      {pack.status === "pending" && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
          {pack.internal?.assignedToName ? (
            <span>{t("pack.onDeskOf", { name: pack.internal.assignedToName })}</span>
          ) : (
            <span className="flex items-center gap-1.5 font-medium text-warning">
              <AlertTriangle className="size-3.5" />
              {t("pack.unassigned")}
            </span>
          )}
          {me !== null && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                void run(
                  () => assignPackFn({ data: { packId: pack.id, take: !mine } }),
                  t(mine ? "pack.done.putBack" : "pack.done.taken"),
                )
              }
            >
              {t(mine ? "pack.putBackAction" : "pack.take")}
            </Button>
          )}
        </div>
      )}

      {pack.items.length === 0 ? (
        <p className="mt-3 rounded-lg bg-secondary/40 px-3 py-2 text-sm">{t("pack.empty")}</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {pack.items.map((item) => (
            <ItemRow key={item.quoteId ?? `${item.rank}-${item.offer.supplierName}`} item={item} />
          ))}
        </ol>
      )}

      {left > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {t("pack.capped", { left, target: targetOffers })}
        </p>
      )}

      {/* The rates this pack's costs may be converted with (V24). Shown on a
          pack that holds some, editable while it is under review. */}
      {(pack.status === "pending" || pack.fxRates.length > 0) && (
        <FxRates pack={pack} editable={canAct} onChanged={onChanged} />
      )}

      {pack.status === "pending" && !canAct && (
        <p className="mt-3 rounded-lg bg-secondary/40 px-3 py-2 text-xs">
          {t("pack.relaunchOpen")}
        </p>
      )}

      {message && (
        <p
          role={message.error ? "alert" : undefined}
          className={cn(
            "mt-3 text-xs",
            message.error ? "font-medium text-destructive" : "text-muted-foreground",
          )}
        >
          {message.text}
        </p>
      )}

      {canAct && mode === null && (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
          <Button
            variant="gold"
            size="sm"
            disabled={busy || shown.length === 0}
            title={shown.length === 0 ? t("pack.refusal.empty") : undefined}
            onClick={() =>
              void run(() => approvePackFn({ data: { packId: pack.id } }), t("pack.done.approved"))
            }
          >
            <Check className="size-4" />
            {t("pack.approve")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy || shown.length === 0}
            onClick={() => open("correct")}
          >
            <Pencil className="size-4" />
            {t("pack.correct")}
          </Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => open("relaunch")}>
            <RotateCcw className="size-4" />
            {t("pack.relaunch")}
          </Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => open("refuse")}>
            <Ban className="size-4" />
            {t("pack.refuse")}
          </Button>
        </div>
      )}

      {canAct && mode === "correct" && (
        <div className="mt-4 rounded-lg border border-border bg-secondary/40 p-4">
          <p className="text-sm font-semibold">{t("pack.correctTitle")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("pack.correctHint")}</p>
          <ol className="mt-3 space-y-1.5">
            {order.map((id, index) => (
              <li
                key={id}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-md bg-background px-3 py-2 text-sm"
              >
                <span className="tabular-nums text-muted-foreground">#{index + 1}</span>
                <span className="truncate">{itemOf(id)?.offer.supplierName}</span>
                <span className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t("pack.moveUp", { supplier: itemOf(id)?.offer.supplierName })}
                    disabled={index === 0}
                    onClick={() => move(id, -1)}
                  >
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t("pack.moveDown", { supplier: itemOf(id)?.offer.supplierName })}
                    disabled={index === order.length - 1}
                    onClick={() => move(id, 1)}
                  >
                    <ArrowDown className="size-4" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => toggleRemoved(id)}>
                    {t("pack.withhold")}
                  </Button>
                </span>
              </li>
            ))}
          </ol>
          {removed.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {removed.map((id) => (
                <li
                  key={id}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground"
                >
                  <span className="truncate">
                    {itemOf(id)?.offer.supplierName} — {t("pack.willBeWithheld")}
                  </span>
                  <Button variant="ghost" size="sm" onClick={() => toggleRemoved(id)}>
                    {t("pack.putBackIn")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <Label htmlFor="pack-correct-note" className="mt-3 block text-xs font-medium">
            {t("pack.correctNote")}
          </Label>
          <Textarea
            id="pack-correct-note"
            value={note}
            maxLength={1000}
            rows={3}
            onChange={(e) => setNote(e.target.value)}
            className="mt-1 text-sm"
          />
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setMode(null)}>
              {t("pack.cancel")}
            </Button>
            <Button
              variant="gold"
              size="sm"
              disabled={busy || noteMissing || order.length === 0}
              onClick={() =>
                void run(
                  () =>
                    correctPackFn({ data: { packId: pack.id, order, removals: removed, note } }),
                  t("pack.done.corrected"),
                )
              }
            >
              {t("pack.correctConfirm")}
            </Button>
          </div>
        </div>
      )}

      {canAct && mode === "relaunch" && (
        <div className="mt-4 rounded-lg border border-border bg-secondary/40 p-4">
          <p className="text-sm font-semibold">{t("pack.relaunchTitle")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("pack.relaunchHint")}</p>
          {!data.replyToSet && (
            <p role="alert" className="mt-2 text-xs font-medium text-destructive">
              {t("pack.refusal.no_reply_address")}{" "}
              <Link to="/interne/parametres" className="underline underline-offset-2">
                {t("rfq.openSettings")}
              </Link>
            </p>
          )}
          {data.candidates.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">{t("pack.noCandidates")}</p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {data.candidates.map((candidate) => (
                <li key={candidate.supplierId}>
                  <label
                    className={cn(
                      "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-md bg-background px-3 py-2 text-sm",
                      !candidate.hasContact && "opacity-60",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="size-4"
                      disabled={!candidate.hasContact}
                      checked={picked.includes(candidate.supplierId)}
                      onChange={(e) =>
                        setPicked(
                          e.target.checked
                            ? [...picked, candidate.supplierId]
                            : picked.filter((id) => id !== candidate.supplierId),
                        )
                      }
                    />
                    <span className="truncate">
                      <span className="tabular-nums text-muted-foreground">#{candidate.rank} </span>
                      {candidate.name}
                    </span>
                    <span
                      className={cn(
                        "text-xs",
                        candidate.state === "no_response" || !candidate.hasContact
                          ? "font-medium text-warning"
                          : "text-muted-foreground",
                      )}
                    >
                      {candidate.hasContact
                        ? t(`pack.candidate.${candidate.state}`)
                        : t("pack.candidateNoContact")}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {/* One who had a full window and said nothing may be asked again —
              but that is a decision, and the page says so. */}
          {data.candidates.some(
            (c) => c.state === "no_response" && picked.includes(c.supplierId),
          ) && <p className="mt-2 text-xs text-warning">{t("pack.noResponseWarning")}</p>}
          <Label htmlFor="pack-relaunch-note" className="mt-3 block text-xs font-medium">
            {t("pack.relaunchNote")}
          </Label>
          <Textarea
            id="pack-relaunch-note"
            value={note}
            maxLength={1000}
            rows={3}
            onChange={(e) => setNote(e.target.value)}
            className="mt-1 text-sm"
          />
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setMode(null)}>
              {t("pack.cancel")}
            </Button>
            <Button
              variant="gold"
              size="sm"
              disabled={busy || noteMissing || picked.length === 0 || !data.replyToSet}
              onClick={() =>
                void run(async () => {
                  const result = await relaunchPackFn({
                    data: { packId: pack.id, supplierIds: picked, note },
                  });
                  // Opened, but some RFQs did not leave: the round exists and
                  // the dossier's RFQ panel will offer to send to them again.
                  if (result.ok && result.failed.length > 0) {
                    return { ok: false, reason: "partly_sent", suppliers: result.failed };
                  }
                  return result;
                }, t("pack.done.relaunched"))
              }
            >
              {t("pack.relaunchConfirm", { count: picked.length })}
            </Button>
          </div>
        </div>
      )}

      {canAct && mode === "refuse" && (
        <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
          <p className="text-sm font-semibold">{t("pack.refuseTitle")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("pack.refuseHint")}</p>
          <Label htmlFor="pack-refuse-reason" className="mt-3 block text-xs font-medium">
            {t("pack.refuseReason")}
          </Label>
          <Textarea
            id="pack-refuse-reason"
            value={note}
            maxLength={1000}
            rows={3}
            onChange={(e) => setNote(e.target.value)}
            className="mt-1 text-sm"
          />
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setMode(null)}>
              {t("pack.cancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy || noteMissing}
              onClick={() =>
                void run(
                  () => refusePackFn({ data: { packId: pack.id, reason: note } }),
                  t("pack.done.refused"),
                )
              }
            >
              {t("pack.refuseConfirm")}
            </Button>
          </div>
        </div>
      )}

      {data.events.length > 0 && (
        <details className="mt-4 rounded-lg border border-border bg-secondary/30 p-3">
          <summary className="cursor-pointer text-xs font-medium">
            {t("pack.history", { count: data.events.length })}
          </summary>
          <ul className="mt-3 space-y-2">
            {data.events.map((event, index) => (
              <EventLine key={`${event.at}-${index}`} event={event} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
