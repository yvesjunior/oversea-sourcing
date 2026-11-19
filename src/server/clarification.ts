// The clarification before launch (Phase V · V18) — the rows.
//
// A buyer holding a DRAFT asks the assistant to read it. The assistant
// restates the need, asks what is missing, and proposes changes to the
// criteria; the buyer answers, and accepts or declines each proposal. Only an
// accept writes a criterion, through the same code as the edit form
// (`src/server/criteria.ts`).
//
// Three rules this file exists to keep:
//
//   1. It runs when the buyer asks, never on its own. There is no job, no
//      timer and no call from the worker: "a pending draft never spends money
//      on its own" (owner, 2026-08-29). Every entry point here is reached
//      from a click.
//   2. It runs on a draft only. Once the search is launched the criteria are
//      what the search was built from; a paid conversation that changes them
//      afterwards changes nothing the buyer will receive.
//   3. It is bounded per request (`CLARIFY_MAX_TURNS`), on turns that reached
//      the model.
//
// The pure rules are `src/lib/clarification.ts`; the model call is
// `src/server/ai/chat.ts`.

import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import {
  absentBasics,
  CLARIFY_MAX_TURNS,
  normalizeProposals,
  normalizeQuestions,
  supersededAdds,
  valueWithUnit,
} from "@/lib/clarification";
import { criteriaEditable } from "@/lib/request-status";
import { recordEvent } from "@/server/requests";

type RequestRow = typeof schema.request.$inferSelect;

export type ClarifyOutcome =
  | { ok: true }
  /** The request is no longer a draft (launched or cancelled meanwhile). */
  | { ok: false; reason: "not_draft" }
  /** Every clarification this request may run has been used. */
  | { ok: false; reason: "limit" }
  /** The model could not be reached. Nothing was spent, nothing is counted. */
  | { ok: false; reason: "unavailable" }
  /** The model answered with nothing usable. Counted: it was paid for. */
  | { ok: false; reason: "no_answer" };

/** Turns that reached the model — the ones `questions` was written on. */
export async function clarifyTurnsUsed(requestId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.requestMessage)
    .where(
      and(
        eq(schema.requestMessage.requestId, requestId),
        eq(schema.requestMessage.role, "assistant"),
        isNotNull(schema.requestMessage.questions),
      ),
    );
  return row?.count ?? 0;
}

/** An assistant turn as the model should read it back: what it said, then
 *  what it asked. The proposals are not replayed — the criteria in the prompt
 *  already show which ones the buyer accepted. */
function turnAsText(content: string, questions: string[] | null): string {
  if (!questions || questions.length === 0) return content;
  return [content, "", ...questions.map((q) => `- ${q}`)].join("\n");
}

function fallback(locale: string, kind: "unavailable" | "no_answer"): string {
  if (kind === "unavailable") {
    return locale === "en"
      ? "The assistant is unavailable right now. Nothing was counted — please try again shortly."
      : "L'assistant est indisponible pour le moment. Rien n'a été décompté — veuillez réessayer dans un instant.";
  }
  return locale === "en"
    ? "I could not read this request. Try describing the product and what you need from a supplier in your own words."
    : "Je n'ai pas pu relire cette demande. Essayez de décrire le produit et ce que vous attendez d'un fournisseur avec vos propres mots.";
}

/**
 * One turn: the buyer asked for a reading (`userMessage` null) or answered.
 *
 * The buyer's message is stored before the call and kept whatever happens —
 * what they typed is theirs, and a model outage is not a reason to lose it.
 */
export async function runClarification(input: {
  request: RequestRow;
  userMessage: string | null;
}): Promise<ClarifyOutcome> {
  const { request, userMessage } = input;
  if (request.status !== "draft") return { ok: false, reason: "not_draft" };
  if ((await clarifyTurnsUsed(request.id)) >= CLARIFY_MAX_TURNS) {
    return { ok: false, reason: "limit" };
  }

  const [criteria, history, earlierRows, { resolvePlan }] = await Promise.all([
    db.query.requestCriterion.findMany({
      where: eq(schema.requestCriterion.requestId, request.id),
      orderBy: [asc(schema.requestCriterion.position)],
    }),
    db.query.requestMessage.findMany({
      where: eq(schema.requestMessage.requestId, request.id),
      orderBy: [asc(schema.requestMessage.createdAt)],
    }),
    db.query.criterionProposal.findMany({
      where: and(
        eq(schema.criterionProposal.requestId, request.id),
        inArray(schema.criterionProposal.status, ["pending", "dismissed"]),
      ),
      orderBy: [asc(schema.criterionProposal.createdAt), asc(schema.criterionProposal.position)],
    }),
    import("@/server/plan"),
  ]);
  const plan = await resolvePlan(request.organizationId);

  if (userMessage) {
    await db.insert(schema.requestMessage).values({
      id: crypto.randomUUID(),
      requestId: request.id,
      role: "user",
      content: userMessage,
    });
  }

  // What earlier turns proposed and the buyer has not accepted: still
  // waiting, or declined. Neither is proposed again (`normalizeProposals`).
  const earlier = earlierRows.map((row) => ({
    id: row.id,
    op: row.op,
    criterionId: row.criterionId,
    label: row.label,
    value: row.value,
    unit: row.unit,
    required: row.required,
    status: row.status === "pending" ? ("pending" as const) : ("dismissed" as const),
  }));
  const asLine = (e: (typeof earlier)[number]) =>
    `${e.op} — ${e.label}: ${valueWithUnit(e.value, e.unit)}`;

  const existing = criteria.map((c) => ({
    id: c.id,
    category: c.category,
    label: c.label,
    value: c.value,
    unit: c.unit,
    required: c.required,
  }));

  let output: Awaited<ReturnType<typeof import("@/server/ai/chat").clarifyRequest>>;
  try {
    const { clarifyRequest } = await import("@/server/ai/chat");
    output = await clarifyRequest({
      title: request.title,
      descriptionRaw: request.descriptionRaw,
      locale: request.locale,
      criteria: existing,
      absent: absentBasics(existing),
      waiting: earlier.filter((e) => e.status === "pending").map(asLine),
      declined: earlier.filter((e) => e.status === "dismissed").map(asLine),
      history: history.map((m) => ({
        role: m.role,
        content: m.role === "assistant" ? turnAsText(m.content, m.questions) : m.content,
      })),
      userMessage,
      modelTier: plan.modelTier,
    });
  } catch (error) {
    console.error(`clarify: the call failed for request ${request.id}`, error);
    // `questions` stays null: this turn is not counted (see the schema).
    await db.insert(schema.requestMessage).values({
      id: crypto.randomUUID(),
      requestId: request.id,
      role: "assistant",
      content: fallback(request.locale, "unavailable"),
    });
    return { ok: false, reason: "unavailable" };
  }

  if (!output) {
    await db.insert(schema.requestMessage).values({
      id: crypto.randomUUID(),
      requestId: request.id,
      role: "assistant",
      content: fallback(request.locale, "no_answer"),
      questions: [],
    });
    return { ok: false, reason: "no_answer" };
  }

  const questions = normalizeQuestions(output.questions);
  const proposals = normalizeProposals(output.operations, existing, earlier);
  const superseded = supersededAdds(proposals, earlier);
  const restatement = output.restatement.trim();
  const messageId = crypto.randomUUID();

  await db.transaction(async (tx) => {
    await tx.insert(schema.requestMessage).values({
      id: messageId,
      requestId: request.id,
      role: "assistant",
      content: restatement,
      questions,
    });
    // "10 weeks after all": the waiting "8 weeks" is withdrawn so that the
    // two are never both on the page with an Accept button. `pending` in the
    // WHERE — if the buyer answered it during the call, their answer stands.
    if (superseded.length > 0) {
      await tx
        .update(schema.criterionProposal)
        .set({ status: "superseded", resolvedAt: new Date() })
        .where(
          and(
            inArray(schema.criterionProposal.id, superseded),
            eq(schema.criterionProposal.status, "pending"),
          ),
        );
    }
    if (proposals.length > 0) {
      await tx.insert(schema.criterionProposal).values(
        proposals.map((proposal, index) => ({
          id: crypto.randomUUID(),
          requestId: request.id,
          messageId,
          op: proposal.op,
          criterionId: proposal.criterionId,
          category: proposal.category,
          label: proposal.label,
          value: proposal.value,
          unit: proposal.unit,
          required: proposal.required,
          previous: proposal.previous,
          previousRequired: proposal.previousRequired,
          position: index,
        })),
      );
    }
    await recordEvent(
      request.id,
      request.organizationId,
      "clarification.asked",
      { questions: questions.length, proposals: proposals.length },
      tx,
    );
    await tx
      .update(schema.request)
      .set({ updatedAt: new Date() })
      .where(eq(schema.request.id, request.id));
  });

  return { ok: true };
}

export type ResolveOutcome =
  | { ok: true; status: "accepted" | "dismissed" }
  /** Already answered — by this buyer in another tab, or by a colleague. */
  | { ok: false; reason: "not_pending" }
  /** Accepted too late: its criterion is gone, or the criteria are frozen. */
  | { ok: false; reason: "stale" };

/**
 * The buyer's answer to one proposal.
 *
 * In one transaction, with the request and the proposal locked: two clicks on
 * the same proposal write one criterion, and an accept racing the launch
 * either lands before it or is refused — never half.
 */
export async function resolveProposal(input: {
  requestId: string;
  proposalId: string;
  accept: boolean;
  actor: { id: string; name: string };
}): Promise<ResolveOutcome> {
  const { insertCriterion, updateCriterion, deleteCriterion, criteriaEdited } =
    await import("@/server/criteria");

  return db.transaction(async (tx): Promise<ResolveOutcome> => {
    const [request] = await tx
      .select()
      .from(schema.request)
      .where(eq(schema.request.id, input.requestId))
      .for("update");
    const [proposal] = await tx
      .select()
      .from(schema.criterionProposal)
      .where(
        and(
          eq(schema.criterionProposal.id, input.proposalId),
          eq(schema.criterionProposal.requestId, input.requestId),
        ),
      )
      .for("update");
    if (!request || !proposal || proposal.status !== "pending") {
      return { ok: false, reason: "not_pending" };
    }

    const settle = async (status: schema.ProposalStatus) => {
      await tx
        .update(schema.criterionProposal)
        .set({
          status,
          resolvedAt: new Date(),
          resolvedBy: input.actor.id,
          resolvedByName: input.actor.name,
        })
        .where(eq(schema.criterionProposal.id, proposal.id));
    };

    if (!input.accept) {
      await settle("dismissed");
      return { ok: true, status: "dismissed" };
    }

    // The same wall a manual edit meets (`criteria-fns.ts`).
    if (!criteriaEditable(request.status)) {
      await settle("stale");
      return { ok: false, reason: "stale" };
    }

    const fields = {
      category: proposal.category,
      label: proposal.label,
      value: proposal.value,
      unit: proposal.unit,
      required: proposal.required,
    };
    let applied: boolean;
    if (proposal.op === "add") {
      await insertCriterion(request.id, fields, tx);
      applied = true;
    } else if (!proposal.criterionId) {
      applied = false;
    } else if (proposal.op === "update") {
      applied = await updateCriterion(request.id, proposal.criterionId, fields, tx);
    } else {
      applied = await deleteCriterion(request.id, proposal.criterionId, tx);
    }

    if (!applied) {
      await settle("stale");
      return { ok: false, reason: "stale" };
    }
    await criteriaEdited(request.id, request.organizationId, tx, input.actor);
    await settle("accepted");
    return { ok: true, status: "accepted" };
  });
}

/** A proposal as the page shows it. */
export type ProposalView = {
  id: string;
  op: schema.ProposalOp;
  category: schema.CriteriaCategory;
  label: string;
  /** "500 pièces" */
  value: string;
  required: boolean;
  /** For an update: what the value was. */
  previous: string | null;
  /** For an update that flips the obligation: which way. */
  requiredChange: "becomes_required" | "becomes_optional" | null;
  status: schema.ProposalStatus;
};

/** Every proposal of a request, grouped by the assistant turn that made it. */
export async function proposalsByMessage(requestId: string): Promise<Map<string, ProposalView[]>> {
  const rows = await db.query.criterionProposal.findMany({
    where: eq(schema.criterionProposal.requestId, requestId),
    orderBy: [asc(schema.criterionProposal.createdAt), asc(schema.criterionProposal.position)],
  });
  const grouped = new Map<string, ProposalView[]>();
  for (const row of rows) {
    const list = grouped.get(row.messageId) ?? [];
    list.push({
      id: row.id,
      op: row.op,
      category: row.category,
      label: row.label,
      value: valueWithUnit(row.value, row.unit),
      required: row.required,
      previous: row.previous,
      requiredChange:
        row.previousRequired === null
          ? null
          : row.required
            ? "becomes_required"
            : "becomes_optional",
      status: row.status,
    });
    grouped.set(row.messageId, list);
  }
  return grouped;
}
