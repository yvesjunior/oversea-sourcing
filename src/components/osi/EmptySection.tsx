import type { LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

export function EmptySection({
  icone: Icone,
  titleKey,
  textKey,
}: {
  icone: LucideIcon;
  titleKey: string;
  textKey: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="pt-6">
      <h1 className="font-display text-2xl font-semibold">{t(titleKey)}</h1>
      <div className="card-surface mt-6 flex flex-col items-center gap-4 px-6 py-20 text-center">
        <span className="grid size-14 place-items-center rounded-2xl bg-gold-soft text-gold">
          <Icone className="size-6" />
        </span>
        <p className="max-w-sm text-sm text-muted-foreground">{t(textKey)}</p>
      </div>
    </div>
  );
}
