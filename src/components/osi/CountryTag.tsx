import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

/** `code`: ISO country code — also the i18n key under "countries". */
export function CountryTag({ code, className }: { code: string; className?: string }) {
  const { t } = useTranslation();
  return (
    <span
      className={cn("flex shrink-0 items-center gap-2 text-xs text-muted-foreground", className)}
    >
      <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-semibold text-foreground">
        {code}
      </span>
      {t(`countries.${code}`)}
    </span>
  );
}
