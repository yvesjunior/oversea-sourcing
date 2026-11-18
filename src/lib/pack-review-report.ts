// « Ce que la revue a changé » — the rules (Phase V · V14). Pure and
// client-safe; the rows come from src/server/pack-report.ts.
//
// The question this answers is the precondition for ever switching the
// release mode to `automatic`: how often does a person looking at a pack
// change what the buyer gets? If the answer is "never", the desk is a wait
// and nothing else. So every figure here is counted from rows that are kept
// (`decision_pack`, `decision_pack_event`, `rfq_round`) and none from the
// audit journal, which is purged at three months.
//
// ── What counts as a change ─────────────────────────────────────────────────
//
// A pack that has been DECIDED ends as exactly one of:
//
//   untouched   a person released it as built, first time round
//   corrected   a person changed the order or took offers out, then released
//   relaunched  released as built, but only after a person had sent it back
//               for at least one more round — the buyer got a different pack
//               than the first close would have given them
//   refused     a person sent nothing
//   automatic   the system released it; nobody looked
//
// "The review changed the pack" = corrected + relaunched + refused, over the
// packs a person decided. `automatic` is in neither side of that ratio.
//
// ── The two waits ───────────────────────────────────────────────────────────
//
// What the buyer lives with is one number: from the first RFQ leaving to the
// pack arriving. It is made of the WINDOW (rounds open, suppliers answering)
// and the DESK (rounds closed, a person deciding). They are shown apart
// because only one of them is OSI's to shorten, and summed because the sum
// is the buyer's.

import type { PackEventAction, PackStatus } from "@/database/schema";

export const REPORT_PERIODS = [30, 90, 365] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

export const PACK_OUTCOMES = [
  "untouched",
  "corrected",
  "relaunched",
  "refused",
  "automatic",
] as const;
export type PackOutcome = (typeof PACK_OUTCOMES)[number];

export type ReportPack = {
  id: string;
  requestId: string;
  status: PackStatus;
  releasedAt: string | null;
  /** Null on a released pack = the system released it. */
  releasedByName: string | null;
};

export type ReportEvent = { packId: string; action: PackEventAction; at: string };

export type ReportRound = {
  requestId: string;
  openedAt: string;
  /** Null while the round is open. */
  closedAt: string | null;
  closeReason: string | null;
};

export type DecidedPack = {
  packId: string;
  requestId: string;
  outcome: PackOutcome;
  decidedAt: string;
  /** Times it was sent back for another round before being decided. */
  relaunches: number;
  /** All three null when no round can be tied to the pack. */
  windowMs: number | null;
  deskMs: number | null;
  totalMs: number | null;
};

export type ReviewReport = {
  outcomes: Record<PackOutcome, number>;
  /** Packs a person decided: everything but `automatic`. */
  reviewed: number;
  /** Of those, the ones the review changed. */
  changed: number;
  /** MEANS, so that window + desk is the total to the millisecond; null when
   *  no decided pack has rounds to measure. */
  waits: {
    packs: number;
    windowMs: number;
    deskMs: number;
    totalMs: number;
    longestMs: number;
  } | null;
  /** Most recently decided first. */
  packs: DecidedPack[];
};

const ms = (iso: string) => new Date(iso).getTime();

/** When and how a pack was decided — null while it is pending, and for a
 *  pack the buyer withdrew (nobody at OSI decided anything). */
function decisionOf(
  pack: ReportPack,
  events: readonly ReportEvent[],
): { at: string; outcome: PackOutcome; relaunches: number } | null {
  const relaunches = events.filter((event) => event.action === "relaunched").length;
  // `events` arrive oldest first.
  const latest = [...events].reverse();
  if (pack.status === "refused") {
    const refusal = latest.find((event) => event.action === "refused");
    return refusal ? { at: refusal.at, outcome: "refused", relaunches } : null;
  }
  if (pack.status !== "released" || !pack.releasedAt) return null;
  const last = latest.find(
    (event) =>
      event.action === "approved" ||
      event.action === "corrected" ||
      event.action === "auto_released",
  );
  // The pack row is the fallback, not the event: a released pack with no
  // event at all still says who released it.
  const outcome: PackOutcome =
    last?.action === "auto_released" || (!last && pack.releasedByName === null)
      ? "automatic"
      : last?.action === "corrected"
        ? "corrected"
        : relaunches > 0
          ? "relaunched"
          : "untouched";
  return { at: pack.releasedAt, outcome, relaunches };
}

/**
 * The report over `[from, to]`, both in epoch milliseconds: every pack
 * decided in that span.
 *
 * `packs`, `events` and `rounds` must hold EVERYTHING about the requests
 * concerned, not only what falls in the span — a pack's wait starts at a
 * round that may have opened before it, and is bounded by the request's
 * previous pack, which may have been decided before it.
 */
export function buildReviewReport(input: {
  packs: readonly ReportPack[];
  events: readonly ReportEvent[];
  rounds: readonly ReportRound[];
  from: number;
  to: number;
}): ReviewReport {
  const eventsByPack = new Map<string, ReportEvent[]>();
  for (const event of [...input.events].sort((a, b) => ms(a.at) - ms(b.at))) {
    const list = eventsByPack.get(event.packId) ?? [];
    list.push(event);
    eventsByPack.set(event.packId, list);
  }
  const decided = input.packs.flatMap((pack) => {
    const decision = decisionOf(pack, eventsByPack.get(pack.id) ?? []);
    return decision ? [{ pack, ...decision }] : [];
  });

  const packs: DecidedPack[] = decided
    .filter((entry) => ms(entry.at) >= input.from && ms(entry.at) <= input.to)
    .map((entry) => {
      const decidedAt = ms(entry.at);
      // A request can have a second pack (an expired offer asked again): its
      // wait starts after the first one was sent, not at round 1.
      const after = Math.max(
        0,
        ...decided
          .filter(
            (other) => other.pack.requestId === entry.pack.requestId && ms(other.at) < decidedAt,
          )
          .map((other) => ms(other.at)),
      );
      const rounds = input.rounds.filter(
        (round) =>
          round.requestId === entry.pack.requestId &&
          round.closedAt !== null &&
          round.closeReason !== "withdrawn" &&
          ms(round.openedAt) >= after &&
          ms(round.closedAt) <= decidedAt,
      );
      const base = {
        packId: entry.pack.id,
        requestId: entry.pack.requestId,
        outcome: entry.outcome,
        decidedAt: entry.at,
        relaunches: entry.relaunches,
      };
      if (rounds.length === 0) return { ...base, windowMs: null, deskMs: null, totalMs: null };
      const windowMs = rounds.reduce(
        (sum, round) => sum + (ms(round.closedAt as string) - ms(round.openedAt)),
        0,
      );
      const totalMs = decidedAt - Math.min(...rounds.map((round) => ms(round.openedAt)));
      return { ...base, windowMs, deskMs: Math.max(0, totalMs - windowMs), totalMs };
    })
    .sort((a, b) => ms(b.decidedAt) - ms(a.decidedAt));

  const outcomes: Record<PackOutcome, number> = {
    untouched: 0,
    corrected: 0,
    relaunched: 0,
    refused: 0,
    automatic: 0,
  };
  for (const pack of packs) outcomes[pack.outcome] += 1;

  const measured = packs.filter((pack) => pack.totalMs !== null);
  const mean = (pick: (pack: DecidedPack) => number | null) =>
    Math.round(measured.reduce((sum, pack) => sum + (pick(pack) ?? 0), 0) / measured.length);
  const windowMs = measured.length > 0 ? mean((pack) => pack.windowMs) : 0;
  const deskMs = measured.length > 0 ? mean((pack) => pack.deskMs) : 0;

  return {
    outcomes,
    reviewed: packs.length - outcomes.automatic,
    changed: outcomes.corrected + outcomes.relaunched + outcomes.refused,
    waits:
      measured.length > 0
        ? {
            packs: measured.length,
            windowMs,
            deskMs,
            // Summed from the two means, not averaged again: rounding each
            // on its own could leave the three a millisecond apart on screen.
            totalMs: windowMs + deskMs,
            longestMs: Math.max(...measured.map((pack) => pack.totalMs as number)),
          }
        : null,
    packs,
  };
}

/** "3 h", "2 j 4 h" — a wait, to the hour. Minutes under one hour: a desk
 *  that answered in twenty minutes should not read as "0 h". */
export function formatWait(msValue: number | null, lang: "fr" | "en"): string {
  if (msValue === null) return "—";
  const minutes = Math.max(0, Math.round(msValue / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const day = lang === "fr" ? "j" : "d";
  return hours < 24 ? `${hours} h` : `${Math.floor(hours / 24)} ${day} ${hours % 24} h`;
}
