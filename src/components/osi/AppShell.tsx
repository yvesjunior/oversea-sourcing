import type { ReactNode } from "react";
import { AppSidebar } from "./AppSidebar";
import { TopBar } from "./TopBar";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen w-full bg-sidebar">
      <div className="hidden md:block">
        <AppSidebar />
      </div>
      <div className="flex min-w-0 flex-1 flex-col bg-background md:rounded-l-[28px]">
        <TopBar />
        <main className="min-w-0 flex-1 px-5 pb-14 pt-2 sm:px-8">{children}</main>
      </div>
    </div>
  );
}
