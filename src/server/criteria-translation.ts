// Cross-language criteria (2026-08-29) — the cached layer over the model.
//
// Runs in the worker at the start of the searching stage, BEFORE store-first
// coverage and matching, because both of them need the English forms: the
// point is that a French request can be answered from — or matched against —
// company information that only exists in English. Supplier NAMES and
// DESCRIPTORS are the everyday case ("Auburn Bearing & Manufacturing"), not
// some edge case: the matcher reads them, and they are English far more often
// than the description is.
//
// The translation memory is what makes this effectively free. Industrial
// vocabulary repeats hard across requests ("acier inoxydable 316L",
// "ISO 9001", "courroies transporteuses"), so after the first few requests
// most terms are cache hits costing one indexed lookup and no tokens.

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/database";
import * as schema from "@/database/schema";
import { translateToEnglish } from "@/server/ai/translate";

const TARGET = "en";

function key(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Ensure this request's criteria carry an English form. Idempotent, and safe
 * to call on every pipeline pass: rows that already have `value_en`, and
 * requests already in English, cost nothing.
 *
 * Never throws. A request whose translation fails keeps matching on its
 * native values exactly as before — degraded reach, not a broken pipeline.
 */
export async function ensureCriteriaTranslated(requestId: string, locale: string): Promise<void> {
  try {
    // An English request needs no translation: its values ARE the English
    // form, and the matcher already tries the native value.
    if (locale === "en") return;

    const rows = await db.query.requestCriterion.findMany({
      where: eq(schema.requestCriterion.requestId, requestId),
    });
    const pending = rows.filter((r) => !r.valueEn && r.value.trim().length > 0);
    if (pending.length === 0) return;

    // 1 — the memory first. Deduped by normalized text, so two criteria with
    //     the same value cost one lookup and at most one translation.
    const wanted = [...new Set(pending.map((r) => key(r.value)))];
    const cached = await db.query.translationMemory.findMany({
      where: and(
        inArray(schema.translationMemory.source, wanted),
        eq(schema.translationMemory.sourceLang, locale),
        eq(schema.translationMemory.targetLang, TARGET),
      ),
    });
    const known = new Map(cached.map((c) => [c.source, c.translated]));
    if (cached.length > 0) {
      await db
        .update(schema.translationMemory)
        .set({ hits: sql`${schema.translationMemory.hits} + 1` })
        .where(
          inArray(
            schema.translationMemory.id,
            cached.map((c) => c.id),
          ),
        );
    }

    // 2 — one batched call for whatever the memory did not hold.
    const missing = wanted.filter((w) => !known.has(w));
    if (missing.length > 0) {
      const translated = await translateToEnglish(missing);
      const fresh: (typeof schema.translationMemory.$inferInsert)[] = [];
      missing.forEach((source, index) => {
        const value = translated[index];
        if (!value) return;
        known.set(source, value);
        fresh.push({
          id: crypto.randomUUID(),
          source,
          sourceLang: locale,
          targetLang: TARGET,
          translated: value,
        });
      });
      if (fresh.length > 0) {
        // onConflictDoNothing: two requests translating the same term at the
        // same instant is normal, and neither should fail for it.
        await db.insert(schema.translationMemory).values(fresh).onConflictDoNothing();
      }
    }

    // 3 — write the English form onto the criteria.
    for (const row of pending) {
      const value = known.get(key(row.value));
      if (!value) continue;
      await db
        .update(schema.requestCriterion)
        .set({ valueEn: value })
        .where(eq(schema.requestCriterion.id, row.id));
    }

    console.log(
      `translate: request ${requestId} — ${pending.length} criterion/criteria, ` +
        `${cached.length} from memory, ${missing.length} translated`,
    );
  } catch (error) {
    console.error(`translate: request ${requestId} — skipped:`, error);
  }
}
