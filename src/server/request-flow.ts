// Which flow a request is on — the database side (Phase V · V05).
//
// The rule itself is pure and lives in src/lib/request-status.ts
// (`requestFlow`): pack if the request is in a pack-only state or ever entered
// `shortlisted`. This file only fetches what that rule needs, for the fns that
// must decide what a workspace may read about its OWN request.
//
// Why so many fns ask. On the pack flow the buyer sees no supplier before the
// Decision Pack (owner, 2026-11-14). The dossier is one door; the quote lists,
// the linked-suppliers list, the documents list and the "offer received" email
// are four more, and each would name the suppliers OSI is soliciting to the
// one party that must not learn them yet. Every one of them filters through
// here, so "is this request on the pack flow?" has exactly one answer.

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import { requestFlow, type RequestFlow } from "@/lib/request-status";

const SHORTLISTED_EVENT = "status.shortlisted";

/** The ids, among `requestIds`, of the requests that are on the pack flow. */
export async function packFlowRequestIds(requestIds: readonly string[]): Promise<Set<string>> {
  const ids = [...new Set(requestIds)];
  if (ids.length === 0) return new Set();
  const [requests, entered] = await Promise.all([
    db
      .select({ id: schema.request.id, status: schema.request.status })
      .from(schema.request)
      .where(inArray(schema.request.id, ids)),
    db
      .selectDistinct({ requestId: schema.requestEvent.requestId })
      .from(schema.requestEvent)
      .where(
        and(
          inArray(schema.requestEvent.requestId, ids),
          eq(schema.requestEvent.type, SHORTLISTED_EVENT),
        ),
      ),
  ]);
  const everShortlisted = new Set(entered.map((row) => row.requestId));
  return new Set(
    requests
      .filter(
        (request) =>
          requestFlow(
            request.status,
            everShortlisted.has(request.id) ? [SHORTLISTED_EVENT] : [],
          ) === "pack",
      )
      .map((request) => request.id),
  );
}

export async function flowOfRequest(requestId: string): Promise<RequestFlow> {
  return (await packFlowRequestIds([requestId])).has(requestId) ? "pack" : "report";
}
