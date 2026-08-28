// Personal accent themes (owner request 2026-08-27): each user picks an
// accent color in Paramètres → Profil; "gold" is the product default. The
// palette works by overriding the two accent variables the stylesheet
// derives everything else from (gradients and the accent shadow are
// color-mix'ed from --gold in src/styles.css), so a theme is two values —
// never a parallel stylesheet.

export const THEMES = {
  gold: { label: "Or · Gold", gold: "oklch(0.72 0.11 85)", goldSoft: "oklch(0.95 0.035 88)" },
  emerald: {
    label: "Émeraude · Emerald",
    gold: "oklch(0.64 0.12 160)",
    goldSoft: "oklch(0.94 0.04 160)",
  },
  ocean: { label: "Océan · Ocean", gold: "oklch(0.6 0.12 245)", goldSoft: "oklch(0.94 0.04 245)" },
  violet: {
    label: "Violet",
    gold: "oklch(0.62 0.13 300)",
    goldSoft: "oklch(0.94 0.045 300)",
  },
  crimson: {
    label: "Carmin · Crimson",
    gold: "oklch(0.6 0.15 20)",
    goldSoft: "oklch(0.94 0.04 20)",
  },
} as const;

export type ThemeColor = keyof typeof THEMES;

export const THEME_KEYS = Object.keys(THEMES) as ThemeColor[];

export function isThemeColor(value: unknown): value is ThemeColor {
  return typeof value === "string" && value in THEMES;
}

/** Apply a user's accent to the document. "gold" (or anything unknown)
 *  removes the overrides so the stylesheet's defaults rule again. */
export function applyTheme(color: string | null | undefined): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!isThemeColor(color) || color === "gold") {
    root.style.removeProperty("--gold");
    root.style.removeProperty("--gold-soft");
    return;
  }
  root.style.setProperty("--gold", THEMES[color].gold);
  root.style.setProperty("--gold-soft", THEMES[color].goldSoft);
}
