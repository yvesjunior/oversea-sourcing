import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

/**
 * Resolve an ISO 3166-1 alpha-2 code to a country name.
 *
 * The `countries.*` i18n block only ever covered the handful of countries in
 * the demo data. Since E4, research returns suppliers from anywhere, so an
 * unlisted code used to render as the raw key ("countries.CZ"). `Intl` knows
 * every code in the user's language, so the translation file is now just an
 * override for names we want to word ourselves.
 */
function countryName(code: string, language: string, translated: string): string {
  if (translated) return translated;
  try {
    return new Intl.DisplayNames([language], { type: "region" }).of(code) ?? code;
  } catch {
    // Invalid or unknown code — the badge already shows it, so show nothing.
    return "";
  }
}

/** `code`: ISO country code — also the optional i18n key under "countries". */
export function CountryTag({ code, className }: { code: string; className?: string }) {
  const { t, i18n } = useTranslation();
  // defaultValue "" so a missing key is falsy rather than the key itself.
  const translated = t(`countries.${code}`, { defaultValue: "" });
  const name = countryName(code, i18n.language, translated);

  return (
    <span
      className={cn("flex min-w-0 items-center gap-2 text-xs text-muted-foreground", className)}
    >
      <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-foreground">
        {code}
      </span>
      <span className="truncate">{name}</span>
    </span>
  );
}
