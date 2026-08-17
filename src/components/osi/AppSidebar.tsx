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
import { authClient } from "@/lib/auth-client";
import { hasPlatformFeature, type PlatformFeature, type PlatformRole } from "@/lib/roles";
import type { SessionData } from "@/lib/session-fns";
import { cn } from "@/lib/utils";

type NavItem = {
  key: string;
  url: string;
  icone: typeof Home;
  /** Hidden entirely unless the platform role has this feature. */
  feature?: PlatformFeature;
  /** Shown but greyed and unclickable — the feature exists, it has no data yet. */
  disabled?: boolean;
  /** Greyed for these platform roles only. Anonymous visitors count as "user". */
  disabledForRoles?: readonly PlatformRole[];
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
  // Nothing on it is wired for buyers (E11), and managers do not administer
  // the platform — owner and accountant keep it.
  { key: "parametres", url: "/parametres", icone: Settings, disabledForRoles: ["user", "manager"] },
];

// Employee features — same dashboard, extra entries per platform role.
// The ops surfaces are still placeholders, so they are greyed for managers
// rather than linking to empty pages; the entries stay visible so the role
// can see what is coming.
const itemsInterne: {
  key: PlatformFeature;
  url: string;
  icone: typeof Home;
  disabledForRoles?: readonly PlatformRole[];
}[] = [
  {
    key: "facilitation",
    url: "/interne/facilitation",
    icone: Handshake,
    disabledForRoles: ["manager"],
  },
  {
    key: "verification",
    url: "/interne/verification",
    icone: ShieldCheck,
    disabledForRoles: ["manager"],
  },
  { key: "imports", url: "/interne/imports", icone: Import, disabledForRoles: ["manager"] },
  { key: "finance", url: "/interne/finance", icone: Wallet, disabledForRoles: ["manager"] },
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
  const platformRole = (session?.user as { platformRole?: string } | undefined)?.platformRole;
  const role = (platformRole ?? "user") as PlatformRole;
  const itemsVisible = items.filter(
    (item) => !item.feature || hasPlatformFeature(platformRole, item.feature),
  );
  const isDisabled = (item: { disabled?: boolean; disabledForRoles?: readonly PlatformRole[] }) =>
    item.disabled === true || (item.disabledForRoles?.includes(role) ?? false);
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
