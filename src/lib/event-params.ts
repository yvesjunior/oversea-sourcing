// Event params → i18n interpolation values.
//
// The three event tables all carry their numbers OUT of the label: recordEvent
// and recordDealEvent JSON-stringify `{count: 6}` into `message`, and
// contract_event keeps the same idea in a jsonb `detail`. The label itself
// stays a translatable sentence with `{{count}}` in it, which is the only way
// FR and EN can put the number in different places.
//
// Which means every surface rendering these events MUST pass the params to
// `t()`. A surface that forgets does not fail — i18next simply prints the
// placeholder, so the dashboard read "Top {{count}} sélectionné sur
// {{analyzed}} fournisseurs analysés" in production for over a week
// (shipped 2026-08-29, found 2026-09-07). Hence one shared parser rather than
// an inline try/catch per consumer.

/** Values i18next can interpolate. Nested objects and arrays are dropped:
 *  a label can only ever print a scalar, and passing the rest through would
 *  invite `{{supplier.name}}`-shaped keys that no translator can see. */
export type EventParams = Record<string, string | number | boolean>;

function scalarsOf(source: Record<string, unknown>): EventParams {
  const params: EventParams = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      params[key] = value;
    }
  }
  return params;
}

/**
 * Parse a `message` column (JSON text, or null when the event took no params).
 * Never throws: a malformed row costs its numbers, not the whole feed.
 */
export function eventParams(message: string | null | undefined): EventParams {
  if (!message) return {};
  try {
    const parsed: unknown = JSON.parse(message);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return scalarsOf(parsed as Record<string, unknown>);
  } catch {
    return {};
  }
}

/** Same, for `contract_event.detail` — already an object, jsonb not text. */
export function detailParams(detail: Record<string, unknown> | null | undefined): EventParams {
  return detail ? scalarsOf(detail) : {};
}
