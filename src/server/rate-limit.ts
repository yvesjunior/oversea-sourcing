// A small fixed-window rate limit for server functions.
//
// better-auth's limiter (`rateLimit.customRules` in auth.ts) covers its own
// endpoints only. A server function reached by anyone holding a URL — the
// RFQ invitation link (V15) — needs its own.
//
// Same storage and same failure rule as better-auth's: Redis when REDIS_URL
// is set (shared across web replicas), otherwise per-process memory; and it
// FAILS OPEN — limiting is protection, not correctness, so a dead Redis must
// never be the reason a supplier cannot register.

import { secondaryStorage } from "@/server/kv";

const memory = new Map<string, { count: number; resetAt: number }>();

/**
 * Count one attempt against `key`. True = allowed.
 *
 * `window` in seconds. The key should name the action and the caller
 * ("invitation:203.0.113.7") — never something the caller chooses freely.
 */
export async function allowAttempt(key: string, max: number, window: number): Promise<boolean> {
  const bucket = `rl:${key}`;
  if (secondaryStorage) {
    const count = await secondaryStorage.increment(bucket, window);
    return count <= max; // 0 on failure → allowed
  }
  const now = Date.now();
  const current = memory.get(bucket);
  if (!current || current.resetAt <= now) {
    memory.set(bucket, { count: 1, resetAt: now + window * 1000 });
    // Bounded by the number of distinct callers per window; swept lazily so
    // a long-lived process does not keep every address it ever saw.
    if (memory.size > 10_000) {
      for (const [k, v] of memory) if (v.resetAt <= now) memory.delete(k);
    }
    return true;
  }
  current.count += 1;
  return current.count <= max;
}

/** The caller's address, from the headers the platform trusts — the same
 *  ones better-auth is configured with. "unknown" groups the callers that
 *  have none, which is the conservative bucket. */
export function callerAddress(headers: Headers): string {
  return (
    headers.get("cf-connecting-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}
