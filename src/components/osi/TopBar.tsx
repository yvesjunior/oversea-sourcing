import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Download, Globe, LogIn, Menu } from "lucide-react";
import { useTranslation } from "react-i18next";
import { STORAGE_KEY, resolveLanguage } from "@/i18n/config";
import type { SessionData } from "@/lib/session-fns";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { AppSidebar } from "./AppSidebar";
import { NotificationBell } from "./NotificationBell";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

export function TopBar({ session }: { session: SessionData }) {
  const { t, i18n } = useTranslation();
  const [menuOuvert, setMenuOuvert] = useState(false);
  const current = resolveLanguage(i18n.language);

  const toggleLangue = () => {
    const next = current === "fr" ? "en" : "fr";
    void i18n.changeLanguage(next);
    window.localStorage.setItem(STORAGE_KEY, next);
    document.documentElement.lang = next;
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
          aria-label={t("topbar.downloads")}
          className="transition-colors hover:text-foreground"
        >
          <Download className="size-[18px]" />
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
