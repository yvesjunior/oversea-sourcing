import { useState } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { Globe, LogIn, Menu, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { resolveLanguage, setLanguageCookie } from "@/i18n/config";
import { setDesignFn } from "@/lib/settings-fns";
import { setDesignCookie, type Design } from "@/lib/themes";
import type { SessionData } from "@/lib/session-fns";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { AppSidebar } from "./AppSidebar";
import { NotificationBell } from "./NotificationBell";
import { UserMenu } from "./UserMenu";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

export function TopBar({ session, design }: { session: SessionData; design: Design }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [menuOuvert, setMenuOuvert] = useState(false);
  const current = resolveLanguage(i18n.language);

  // Write the cookie, then invalidate: beforeLoad re-resolves the language and
  // the tree re-renders with the other i18n instance. Deliberately NOT
  // `changeLanguage` on a shared instance — that is what leaked across
  // concurrent SSR renders and broke hydration (see src/i18n/config.ts).
  const toggleLangue = () => {
    const next = current === "fr" ? "en" : "fr";
    setLanguageCookie(next);
    void router.invalidate();
  };

  // Same shape as the language: write the cookie so the SERVER renders the
  // design on the next request, then invalidate so the class on <html>
  // updates now. Signed-in visitors also store it on the account, so the
  // choice follows them to another browser; anonymous ones keep the cookie.
  const toggleDesign = () => {
    const next: Design = design === "dark" ? "light" : "dark";
    setDesignCookie(next);
    if (session) void setDesignFn({ data: { design: next } }).catch(() => {});
    void router.invalidate();
  };

  return (
    <div className="flex items-center gap-5 px-8 pt-6 text-muted-foreground">
      <Sheet open={menuOuvert} onOpenChange={setMenuOuvert}>
        <SheetTrigger
          aria-label={t("topbar.openMenu")}
          className="transition-colors hover:text-foreground md:hidden"
        >
          <Menu className="size-[18px]" />
        </SheetTrigger>
        <SheetContent side="left" className="w-[248px] border-0 p-0">
          <SheetTitle className="sr-only">{t("topbar.navTitle")}</SheetTitle>
          <AppSidebar session={session} onNavigate={() => setMenuOuvert(false)} />
        </SheetContent>
      </Sheet>

      <div className="ml-auto flex items-center gap-5">
        {session && <WorkspaceSwitcher />}
        <button
          type="button"
          onClick={toggleDesign}
          aria-label={t(design === "dark" ? "topbar.designLight" : "topbar.designDark")}
          title={t(design === "dark" ? "topbar.designLight" : "topbar.designDark")}
          className="transition-colors hover:text-foreground"
        >
          {design === "dark" ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
        </button>
        <button
          onClick={toggleLangue}
          aria-label={t("topbar.switchLanguage")}
          className="flex items-center gap-2 text-xs font-semibold uppercase transition-colors hover:text-foreground"
        >
          <Globe className="size-[18px]" />
          {current}
        </button>
        {session && <NotificationBell />}
        {/* Profile + déconnexion live here since 2026-08-28 (owner request) —
            the sidebar bottom block is gone; the sidebar is navigation. */}
        {session && <UserMenu session={session} />}
        {!session && (
          <Link
            to="/login"
            className="flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <LogIn className="size-3.5" /> {t("auth.submitSignin")}
          </Link>
        )}
      </div>
    </div>
  );
}
