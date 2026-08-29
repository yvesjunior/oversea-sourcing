// Internationalization — FR by default, EN as the fallback (README §7).
//
// The visitor's language lives in a COOKIE, not localStorage (2026-08-29).
// That is the whole point: the SERVER has to render in it. The previous
// design stored the choice in localStorage and applied it in a
// post-hydration effect, on the theory that always server-rendering the
// default keeps the markup stable. It does not: React 19 hydrates
// progressively, so the root's effect fires while child subtrees are still
// hydrating, `changeLanguage` re-renders react-i18next's subscribers, and
// those children hydrate French server HTML against English client output —
// React then throws away the server HTML and re-renders the whole root.
// A cookie travels with the document request, so SSR and the first client
// render agree from the first byte and no switching is needed at all.
//
// ONE INSTANCE PER LANGUAGE, memoized. Never a single mutable singleton: the
// SSR process serves concurrent requests from one module graph, so a
// `changeLanguage` on a shared instance would leak one visitor's language
// into another's render. Each instance here is created with a fixed `lng`
// and never changes; the active one is handed to the tree through
// <I18nextProvider> in __root.

import i18next, { type i18n as I18nInstance } from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";
import fr from "./locales/fr.json";

export const LANGUAGES = ["fr", "en"] as const;
export type Language = (typeof LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = "fr";

/** Cookie carrying the visitor's choice. Readable by the server (that is why
 *  it is not localStorage) and by the client, so no JS is needed to pick the
 *  language for the first render. */
export const LANG_COOKIE = "osi-lang";
const LANG_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const resources = {
  fr: { translation: fr },
  en: { translation: en },
} as const;

const instances = new Map<Language, I18nInstance>();

/** The i18n instance for one language — created once, then reused. */
export function getI18n(lang: Language): I18nInstance {
  const existing = instances.get(lang);
  if (existing) return existing;

  const instance = i18next.createInstance();
  void instance.use(initReactI18next).init({
    resources,
    lng: lang,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: LANGUAGES,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
  instances.set(lang, instance);
  return instance;
}

export function resolveLanguage(value: string | null | undefined): Language {
  return value && (LANGUAGES as readonly string[]).includes(value)
    ? (value as Language)
    : DEFAULT_LANGUAGE;
}

/**
 * The language named by a cookie string — either a request's `Cookie` header
 * (server) or `document.cookie` (client). Null when absent or unrecognised,
 * so the caller can fall back to the account's locale before the default.
 */
export function languageFromCookie(raw: string | null | undefined): Language | null {
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name !== LANG_COOKIE) continue;
    const value = decodeURIComponent(rest.join("="));
    return (LANGUAGES as readonly string[]).includes(value) ? (value as Language) : null;
  }
  return null;
}

/** Persist the choice so the NEXT document request is server-rendered in it.
 *  Not `httpOnly` on purpose — the client reads it too. */
export function setLanguageCookie(lang: Language): void {
  if (typeof document === "undefined") return;
  document.cookie = `${LANG_COOKIE}=${lang}; path=/; max-age=${LANG_COOKIE_MAX_AGE}; samesite=lax`;
}
