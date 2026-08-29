import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import {
  BarChart3,
  Database,
  FileText,
  Home,
  Inbox,
  LogIn,
  LogOut,
  CreditCard,
  ScrollText,
  Settings,
  ShieldCheck,
  Repeat,
  UserCog,
  Users,
  Handshake,
  Wallet,
  Briefcase,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { authClient } from "@/lib/auth-client";
import { hasSessionFeature } from "@/lib/auth-guard";
import { type PlatformFeature } from "@/lib/roles";
import type { SessionData } from "@/lib/session-fns";
import { cn } from "@/lib/utils";

type NavItem = {
  key: string;
  url: string;
  icone: typeof Home;
  /** Hidden entirely unless the session's permission set has this feature
   *  (the Rôles & accès matrix since 2026-08-28). */
  feature?: PlatformFeature;
  /** Shown but greyed and unclickable — the feature exists, it has no data yet. */
  disabled?: boolean;
};

const items: NavItem[] = [
  { key: "accueil", url: "/", icone: Home },
  { key: "demandes", url: "/demandes", icone: Inbox },
  { key: "fournisseurs", url: "/fournisseurs", icone: Users },
  // Disabled rather than removed: the buyer should see the journey continues
  // past the report, even while these pages hold nothing real (E8 / E3+).
  { key: "transactions", url: "/transactions", icone: Repeat, disabled: true },
  { key: "documents", url: "/documents", icone: FileText, disabled: true },
  // Employee-only (PLATFORM_FEATURES.analytics) — filtered per role below.
  { key: "analyses", url: "/analyses", icone: BarChart3, feature: "analytics" },
  // Real since B5 (2026-08-23): profile, subscription view, sourcing
  // preferences and (owner) the member list — live for every role.
  { key: "parametres", url: "/parametres", icone: Settings },
];

// Employee features — same dashboard, extra entries per the Rôles & accès
// matrix (2026-08-28): a granted feature is a live link, an ungranted one is
// hidden. The old per-role greying went with the hardcoded grants.
const itemsInterne: {
  key: PlatformFeature;
  url: string;
  icone: typeof Home;
}[] = [
  { key: "facilitation", url: "/interne/facilitation", icone: Handshake },
  // Real screen since S5c (2026-08-26) — live for managers too.
  { key: "verification", url: "/interne/verification", icone: ShieldCheck },
  // Customer accounts (individual vs organisation), 2026-08-26.
  { key: "clients", url: "/interne/clients", icone: Briefcase },
  { key: "finance", url: "/interne/finance", icone: Wallet },
  // Real screen, not a placeholder — so it stays live for managers.
  { key: "plans", url: "/interne/plans", icone: CreditCard },
  // Platform user management: accounts, roles, plan assignment (2026-08-23).
  { key: "users", url: "/interne/utilisateurs", icone: UserCog },
  // The audit journal — own entry since 2026-08-27 (was on Utilisateurs).
  { key: "logging", url: "/interne/logging", icone: ScrollText },
  // Data-source catalogue: enable/refresh/ban (C1).
  { key: "sources", url: "/interne/sources", icone: Database },
];

export function AppSidebar({
  session,
  onNavigate,
}: {
  session: SessionData;
  onNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = useRouterState({ select: (r) => r.location.pathname });
  const itemsVisible = items.filter(
    (item) => !item.feature || hasSessionFeature(session, item.feature),
  );
  const isDisabled = (item: { disabled?: boolean }) => item.disabled === true;
  const interneVisible = itemsInterne.filter((item) => hasSessionFeature(session, item.key));

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
        {itemsVisible.map((item) => {
          const actif = item.url === "/" ? pathname === "/" : pathname.startsWith(item.url);
          const rowBase =
            "flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition-colors";

          // Rendered as a span, not a disabled Link: an anchor with a href is
          // still followable by keyboard and middle-click however it is styled.
          if (isDisabled(item)) {
            return (
              <span
                key={item.url}
                aria-disabled="true"
                title={t("nav.soon")}
                className={cn(rowBase, "cursor-not-allowed text-sidebar-foreground/30")}
              >
                <item.icone className="size-[18px] shrink-0" />
                <span className="truncate">{t(`nav.${item.key}`)}</span>
              </span>
            );
          }

          return (
            <Link
              key={item.url}
              to={item.url}
              onClick={onNavigate}
              className={cn(
                rowBase,
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
              const rowBase =
                "flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition-colors";

              return (
                <Link
                  key={item.url}
                  to={item.url}
                  onClick={onNavigate}
                  className={cn(
                    rowBase,
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

      {/* The signed-in profile block moved to the header's UserMenu
          (owner request 2026-08-28) — the sidebar is navigation only. */}
      {!session?.user && (
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
