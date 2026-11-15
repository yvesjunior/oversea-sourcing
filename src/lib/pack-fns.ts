// The Decision Pack — server fns (Phase V · V10). Staff only, `deals`.
//
// Nothing here is for the workspace that owns the request: a pending pack is
// OSI's working draft. The buyer's reader arrives with the release (V11) and
// the page that shows it (V12), through `getPackView(…, "buyer")`.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { RequestPackView } from "@/server/decision-pack";

export type { RequestPackView } from "@/server/decision-pack";
export type {
  PackItemView,
  PackOfferSnapshot,
  PackRankingReason,
  PackView,
} from "@/lib/decision-pack";

/** The request's most recent pack. Null for anyone but staff holding
 *  `deals`, and when no round of the request has closed into a review. */
export const getPackForRequestFn = createServerFn({ method: "GET" })
  .inputValidator(z.object({ requestId: z.string().min(1) }))
  .handler(async ({ data }): Promise<RequestPackView | null> => {
    const [{ auth }, { getRequest }, { effectiveHasPermission }] = await Promise.all([
      import("@/server/auth"),
      import("@tanstack/react-start/server"),
      import("@/server/workspace-guard"),
    ]);
    const session = await auth.api.getSession({ headers: getRequest().headers });
    if (!session || !(await effectiveHasPermission(session, "deals"))) return null;
    const { loadPackForRequest } = await import("@/server/decision-pack");
    return await loadPackForRequest(data.requestId);
  });
