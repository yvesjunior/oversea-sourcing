import { Link, useRouterState } from "@tanstack/react-router";
import { BarChart3, FileText, Home, Inbox, Settings, Repeat, Users, Handshake } from "lucide-react";
import { useTranslation } from "react-i18next";
import { utilisateur } from "@/data/osi";
import { cn } from "@/lib/utils";

const items = [
  { key: "accueil", url: "/", icone: Home },
  { key: "demandes", url: "/demandes", icone: Inbox },
  { key: "fournisseurs", url: "/fournisseurs", icone: Users },
  { key: "transactions", url: "/transactions", icone: Repeat },
  { key: "partenaires", url: "/partenaires", icone: Handshake },
  { key: "documents", url: "/documents", icone: FileText },
  { key: "analyses", url: "/analyses", icone: BarChart3 },
  { key: "parametres", url: "/parametres", icone: Settings },
];

export function AppSidebar({ onNavigate }: { onNavigate?: () => void } = {}) {
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (r) => r.location.pathname });

  return (
    <aside className="flex h-full w-[248px] shrink-0 flex-col bg-sidebar text-sidebar-foreground">
      <div className="px-6 py-8 text-center">
        <span className="font-display text-4xl font-extrabold tracking-tight text-gradient-gold">
          OSI
        </span>
        <p className="mt-1 text-[10px] tracking-wide text-sidebar-foreground/50">
          {t("brand.tagline")}
        </p>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-2">
        {items.map((item) => {
          const actif = item.url === "/" ? pathname === "/" : pathname.startsWith(item.url);
          return (
            <Link
              key={item.url}
              to={item.url}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition-colors",
                actif
                  ? "bg-sidebar-primary text-sidebar-primary-foreground"
                  : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              <item.icone className="size-[18px] shrink-0" />
              <span className="truncate">{t(`nav.${item.key}`)}</span>
            </Link>
          );
        })}
      </nav>

      <div className="m-3 flex min-w-0 items-center gap-3 rounded-xl px-3 py-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground">
          {utilisateur.initiales}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{utilisateur.nom}</span>
          <span className="block truncate text-xs text-sidebar-foreground/50">
            {t(utilisateur.role)}
          </span>
        </span>
      </div>
    </aside>
  );
}
