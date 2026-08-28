import type { ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";
import type { SessionData } from "@/lib/session-fns";
import { AppSidebar } from "./AppSidebar";
import { TopBar } from "./TopBar";

const BARE_ROUTES = ["/login", "/signup", "/2fa"];

export function AppShell({ session, children }: { session: SessionData; children: ReactNode }) {
  const pathname = useRouterState({ select: (r) => r.location.pathname });

  // Auth pages render without the app chrome (no sidebar, no topbar).
  if (BARE_ROUTES.some((p) => pathname.startsWith(p))) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-background px-4 py-10">
        {children}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen w-full bg-sidebar print:block print:min-h-0">
      <div className="hidden print:hidden md:block">
        <AppSidebar session={session} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col bg-background md:rounded-l-[28px] print:rounded-none">
        <div className="print:hidden">
          <TopBar session={session} />
        </div>
        <main className="flex min-w-0 flex-1 flex-col px-5 pb-8 pt-2 sm:px-8 print:p-0">
          {children}
        </main>
      </div>
    </div>
  );
}
