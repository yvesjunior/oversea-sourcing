import type { ReactNode } from "react";
import { useRouter } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import type { SessionData } from "@/lib/session-fns";

/**
 * The shell of the EXTERNAL accounts' surface (Phase V · V03).
 *
 * Deliberately not `AppShell`: that sidebar is the buyer's and staff's, and
 * every entry in it leads somewhere an external account is refused. A
 * supplier's person sees the brand, who they are signed in as, and the way
 * out — the portal's own pages bring the rest (V15, V16).
 */
export function PortalShell({
  session,
  surface = "supplier",
  children,
}: {
  session: SessionData;
  /** Whose surface this is: the supplier portal or the Partner Hub (V23).
   *  Same shell — brand, who is signed in, the way out — its own name. */
  surface?: "supplier" | "partner";
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const router = useRouter();

  const signOut = async () => {
    await authClient.signOut();
    await router.invalidate();
    await router.navigate({ to: "/login" });
  };

  return (
    <div className="flex min-h-screen w-full flex-col bg-background">
      <header className="border-b border-border">
        <div className="mx-auto grid w-full max-w-4xl grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 py-4 sm:px-8">
          <div className="min-w-0">
            <p className="font-display text-xl font-semibold tracking-wide text-gold">OSI</p>
            <p className="truncate text-xs text-muted-foreground">
              {t(surface === "partner" ? "partnerHub.shellTitle" : "portal.shellTitle")}
            </p>
          </div>
          {session && (
            <div className="flex items-center gap-3">
              <span className="hidden truncate text-sm text-muted-foreground sm:inline">
                {session.user.name || session.user.email}
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={() => void signOut()}>
                <LogOut className="size-4" /> {t("portal.signOut")}
              </Button>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-5 py-8 sm:px-8">
        {children}
      </main>
    </div>
  );
}
