// The top-right profile menu (owner request 2026-08-28): avatar → profile
// information + Paramètres + sign-out. Replaces the block that lived at the
// bottom of the sidebar — account actions belong to the header, the sidebar
// is navigation.

import { Link, useRouter } from "@tanstack/react-router";
import { LogOut, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { authClient } from "@/lib/auth-client";
import type { SessionData } from "@/lib/session-fns";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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

export function UserMenu({ session }: { session: NonNullable<SessionData> }) {
  const { t } = useTranslation();
  const router = useRouter();
  const platformRole = (session.user as { platformRole?: string }).platformRole ?? "user";

  const signOut = async () => {
    await authClient.signOut();
    await router.invalidate();
    await router.navigate({ to: "/" });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("topbar.profileMenu")}
        className="grid size-9 shrink-0 place-items-center rounded-full bg-gold-gradient text-xs font-semibold text-gold-foreground shadow-gold transition-opacity hover:opacity-90"
      >
        {initialsOf(session.user.name)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {/* Profile information — who is signed in, at a glance. */}
        <div className="px-2 py-1.5">
          <p className="truncate text-sm font-semibold">{session.user.name}</p>
          <p className="truncate text-xs text-muted-foreground">{session.user.email}</p>
          {platformRole !== "user" && (
            <span className="mt-1.5 inline-block rounded-full bg-gold-gradient px-2 py-0.5 text-[10px] font-semibold text-gold-foreground">
              {t(`platformRoles.${platformRole}`, { defaultValue: platformRole })}
            </span>
          )}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/parametres" className="flex cursor-pointer items-center gap-2">
            <Settings className="size-4" />
            {t("nav.parametres")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => void signOut()}
          className="cursor-pointer text-destructive focus:text-destructive"
        >
          <LogOut className="size-4" />
          {t("auth.signout")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
