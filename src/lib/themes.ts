// Two independent visual axes (owner decision 2026-08-29: "we will have two
// designs — we keep the original and the second one; the user can switch").
//
//   DESIGN  light | dark — the whole neutral ramp: background, surfaces,
//           text, borders. `dark` is the portal brief's noir/anthracite
//           identity (#111111 · #1E1E1E · #202020 · #E6E6E6). Applied as the
//           `dark` class on <html>, whose token block lives in styles.css.
//   ACCENT  five palettes — ONE variable, `--gold`; everything else
//           (gradients, the accent shadow, --gold-soft) is color-mix'ed from
//           it in the stylesheet, per design. Never a parallel stylesheet.
//
// The DESIGN travels in a cookie, like the language and for the same reason:
// the SERVER renders <html class="dark">, so there is no flash of the wrong
// theme and no hydration mismatch. It is also stored on the account, so the
// choice follows the person to another device.

export const DESIGNS = ["light", "dark"] as const;
export type Design = (typeof DESIGNS)[number];
export const DEFAULT_DESIGN: Design = "light";

/** Read by the server from the request's Cookie header, by the client from
 *  document.cookie. Not httpOnly — both sides need it. */
export const DESIGN_COOKIE = "osi-design";
const DESIGN_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isDesign(value: unknown): value is Design {
  return typeof value === "string" && (DESIGNS as readonly string[]).includes(value);
}

export function resolveDesign(value: string | null | undefined): Design {
  return isDesign(value) ? value : DEFAULT_DESIGN;
}

/** The design named by a cookie string, or null when absent/unrecognised —
 *  so the caller can fall back to the account's saved choice before the
 *  default. Same shape as languageFromCookie in src/i18n/config.ts. */
export function designFromCookie(raw: string | null | undefined): Design | null {
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== DESIGN_COOKIE) continue;
    const value = decodeURIComponent(rest.join("="));
    return isDesign(value) ? value : null;
  }
  return null;
}

/** Persist the choice so the NEXT document request is server-rendered in it. */
export function setDesignCookie(design: Design): void {
  if (typeof document === "undefined") return;
  document.cookie = `${DESIGN_COOKIE}=${design}; path=/; max-age=${DESIGN_COOKIE_MAX_AGE}; samesite=lax`;
}

// ── Accent ──────────────────────────────────────────────────────────────────

/** Each accent is ONE value. `--gold-soft` used to be a second stored colour;
 *  it is now derived in styles.css per design (a near-white tint reads as a
 *  glaring block on the dark ground), so an accent cannot be light-only by
 *  construction. */
export const THEMES = {
  gold: { label: "Or · Gold", gold: "oklch(0.72 0.11 85)" },
  emerald: { label: "Émeraude · Emerald", gold: "oklch(0.64 0.12 160)" },
  ocean: { label: "Océan · Ocean", gold: "oklch(0.6 0.12 245)" },
  violet: { label: "Violet", gold: "oklch(0.62 0.13 300)" },
  crimson: { label: "Carmin · Crimson", gold: "oklch(0.6 0.15 20)" },
} as const;

export type ThemeColor = keyof typeof THEMES;

export const THEME_KEYS = Object.keys(THEMES) as ThemeColor[];

export function isThemeColor(value: unknown): value is ThemeColor {
  return typeof value === "string" && value in THEMES;
}

/** Apply a user's accent to the document. "gold" (or anything unknown)
 *  removes the override so the stylesheet's default rules again. */
export function applyTheme(color: string | null | undefined): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!isThemeColor(color) || color === "gold") {
    root.style.removeProperty("--gold");
    return;
  }
  root.style.setProperty("--gold", THEMES[color].gold);
}
