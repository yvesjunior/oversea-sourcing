import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import {
  BarChart3,
  FileText,
  Home,
  Import,
  Inbox,
  LogIn,
  LogOut,
  Settings,
  ShieldCheck,
  Repeat,
  Users,
  Handshake,
  Wallet,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { authClient, useSession } from "@/lib/auth-client";
import { hasPlatformFeature, type PlatformFeature } from "@/lib/roles";
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

// Employee features — same dashboard, extra entries per platform role.
const itemsInterne: { key: PlatformFeature; url: string; icone: typeof Home }[] = [
  { key: "facilitation", url: "/interne/facilitation", icone: Handshake },
  { key: "verification", url: "/interne/verification", icone: ShieldCheck },
  { key: "imports", url: "/interne/imports", icone: Import },
  { key: "finance", url: "/interne/finance", icone: Wallet },
];

function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?"
  );
}

export function AppSidebar({ onNavigate }: { onNavigate?: () => void } = {}) {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const { data: session } = useSession();
  const platformRole = (session?.user as { platformRole?: string } | undefined)?.platformRole;
  const interneVisible = itemsInterne.filter((item) => hasPlatformFeature(platformRole, item.key));

  const seDeconnecter = async () => {
    await authClient.signOut();
    await router.invalidate();
    await router.navigate({ to: "/" });
  };

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

        {interneVisible.length > 0 && (
          <>
            <p className="px-4 pb-1 pt-5 text-[10px] font-semibold uppercase tracking-widest text-sidebar-foreground/40">
              {t("nav.interne")}
            </p>
            {interneVisible.map((item) => {
              const actif = pathname.startsWith(item.url);
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
          </>
        )}
      </nav>

      {session?.user ? (
        <div className="m-3 flex min-w-0 items-center gap-3 rounded-xl px-3 py-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-sidebar-accent text-xs font-semibold text-sidebar-accent-foreground">
            {initialsOf(session.user.name)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{session.user.name}</span>
            <span className="block truncate text-xs text-sidebar-foreground/50">
              {session.user.email}
            </span>
          </span>
          <button
            onClick={() => void seDeconnecter()}
            aria-label={t("auth.signout")}
            title={t("auth.signout")}
            className="shrink-0 text-sidebar-foreground/50 transition-colors hover:text-sidebar-foreground"
          >
            <LogOut className="size-[18px]" />
          </button>
        </div>
      ) : (
        <div className="m-3">
          <Link
            to="/login"
            onClick={onNavigate}
            className="flex items-center justify-center gap-2 rounded-xl bg-sidebar-accent px-3 py-3 text-sm font-medium text-sidebar-accent-foreground transition-colors hover:bg-sidebar-primary"
          >
            <LogIn className="size-4" /> {t("auth.submitSignin")}
          </Link>
        </div>
      )}
    </aside>
  );
}
