import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./locales/en.json";
import fr from "./locales/fr.json";

export const LANGUAGES = ["fr", "en"] as const;
export type Language = (typeof LANGUAGES)[number];
export const DEFAULT_LANGUAGE: Language = "fr";
export const STORAGE_KEY = "osi-lang";

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources: {
      fr: { translation: fr },
      en: { translation: en },
    },
    lng: DEFAULT_LANGUAGE,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: LANGUAGES,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });
}

export function resolveLanguage(value: string | null | undefined): Language {
  return value && (LANGUAGES as readonly string[]).includes(value)
    ? (value as Language)
    : DEFAULT_LANGUAGE;
}

export default i18n;
