import { Link } from "@tanstack/react-router";
import { ChevronRight, Handshake, Import, ShieldCheck, Wallet } from "lucide-react";
import { useTranslation } from "react-i18next";
import { hasPlatformFeature, type PlatformFeature } from "@/lib/roles";
import type { OpsSummary } from "@/lib/stats-fns";

const cartes: { key: PlatformFeature; url: string; icone: typeof Handshake }[] = [
  { key: "facilitation", url: "/interne/facilitation", icone: Handshake },
  { key: "verification", url: "/interne/verification", icone: ShieldCheck },
  { key: "imports", url: "/interne/imports", icone: Import },
  { key: "finance", url: "/interne/finance", icone: Wallet },
];

/** Employee block on the home dashboard — same dashboard for everyone,
 *  features added per platform role. */
export function InterneSection({
  platformRole,
  ops,
}: {
  platformRole: string | undefined;
  ops: OpsSummary;
}) {
  const { t } = useTranslation();
  const visibles = cartes.filter((carte) => hasPlatformFeature(platformRole, carte.key));
  if (visibles.length === 0) return null;

  return (
    <section>
      <h2 className="truncate text-lg font-semibold">{t("interne.title")}</h2>
      <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {visibles.map((carte) => {
          const sousTitre =
            carte.key === "facilitation" && ops
              ? t("interne.facilitationCount", { count: ops.buyersDossiers })
              : t("interne.soon");
          return (
            <Link
              key={carte.key}
              to={carte.url}
              className="card-surface group flex items-center gap-4 p-5 transition-all hover:-translate-y-0.5 hover:border-gold/50 hover:shadow-gold"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-gold-soft text-gold">
                <carte.icone className="size-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">
                  {t(`nav.${carte.key}`)}
                </span>
                <span className="block truncate text-xs text-muted-foreground">{sousTitre}</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-gold" />
            </Link>
          );
        })}
      </div>
    </section>
  );
}
