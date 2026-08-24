// Redis-backed secondary storage for better-auth — distributed rate limiting.
//
// Optional by design: with no REDIS_URL the app keeps better-auth's in-memory
// counters (fine for a single web container). Set REDIS_URL (the `cache`
// addon: redis://redis:6379) and rate-limit counters become shared across
// replicas — the documented swap in README §6 Security baseline.
//
// Every operation FAILS OPEN: rate limiting is protection, not correctness,
// so a dead Redis must degrade to "not rate limited" — never to broken logins.
// This is also why sessions stay in Postgres (auth.ts pins
// storeSessionInDatabase) — Redis here is disposable cache, not state.

import { Redis } from "ioredis";

const redisUrl = process.env["REDIS_URL"];

let warned = false;
function warnOnce(error: unknown): void {
  if (warned) return;
  warned = true;
  console.warn("kv: Redis unavailable — rate limiting degrades to fail-open", error);
}

function createClient(url: string): Redis {
  // Connect eagerly: with the offline queue disabled, a lazy connection would
  // make the FIRST command always fail ("Stream isn't writeable") before the
  // socket exists. Eager + no queue = commands fail only while Redis is
  // genuinely down, which is exactly what fail-open wants.
  const client = new Redis(url, {
    // Fail fast instead of buffering commands forever while Redis is down —
    // the fail-open catch below needs errors, not hangs.
    maxRetriesPerRequest: 1,
    commandTimeout: 500,
    enableOfflineQueue: false,
  });
  client.on("error", warnOnce);
  return client;
}

/** better-auth `secondaryStorage` — null when REDIS_URL is not configured. */
export const secondaryStorage = redisUrl
  ? (() => {
      const redis = createClient(redisUrl);
      return {
        get: async (key: string): Promise<string | null> => {
          try {
            return await redis.get(key);
          } catch (error) {
            warnOnce(error);
            return null;
          }
        },
        set: async (key: string, value: string, ttl?: number): Promise<void> => {
          try {
            if (ttl) await redis.set(key, value, "EX", ttl);
            else await redis.set(key, value);
          } catch (error) {
            warnOnce(error);
          }
        },
        delete: async (key: string): Promise<void> => {
          try {
            await redis.del(key);
          } catch (error) {
            warnOnce(error);
          }
        },
        // Atomic consume path of better-auth's rate limiter: INCR + first-write
        // TTL. Returning 0 on failure means "allowed" — fail-open.
        increment: async (key: string, ttl?: number): Promise<number> => {
          try {
            const count = await redis.incr(key);
            if (count === 1 && ttl) await redis.expire(key, ttl);
            return count;
          } catch (error) {
            warnOnce(error);
            return 0;
          }
        },
      };
    })()
  : null;
