// Workspace indicator + switcher (B2, 2023-08-23 · made prominent 2026-08-26
// on owner request: "we must know where we are connected").
//
// ALWAYS visible when signed in: a color-coded badge naming the active
// workspace — gold for the staff org (internal), teal-tinted for an
// enterprise, neutral-but-legible for a personal workspace. With several
// memberships it becomes the dropdown switcher; the active organization
// lives in the SESSION (better-auth org plugin), so every server fn
// re-scopes on the next call — the switch itself never carries data across.

import { useEffect, useState } from "react";
import { useRouter, useRouterState } from "@tanstack/react-router";
import { Building2, Check, ChevronsUpDown, ShieldCheck, User } from "lucide-react";
import { useTranslation } from "react-i18next";
import { authClient } from "@/lib/auth-client";
import { getMyWorkspacesFn, type WorkspaceSummary } from "@/lib/workspace-fns";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

/** The badge look per organization.type — the color IS the information. */
const TYPE_STYLES: Record<string, string> = {
  internal: "bg-gold-gradient text-gold-foreground shadow-gold border-transparent",
  enterprise: "bg-emerald-500/15 text-emerald-700 border-emerald-500/40 dark:text-emerald-400",
  individual: "bg-secondary text-foreground border-border",
};

function TypeIcon({ type }: { type: string }) {
  if (type === "internal") return <ShieldCheck className="size-4 shrink-0" />;
  if (type === "enterprise") return <Building2 className="size-4 shrink-0" />;
  return <User className="size-4 shrink-0" />;
}

export function WorkspaceSwitcher() {
  const { t } = useTranslation();
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [switching, setSwitching] = useState(false);
  const href = useRouterState({ select: (r) => r.location.href });

  // Refetch on every navigation (an accepted invitation lands on "/" with a
  // membership the mount-time fetch never saw) and on the explicit signal a
  // same-page mutation sends (workspace rename).
  useEffect(() => {
    void getMyWorkspacesFn().then(setWorkspaces);
  }, [href]);
  useEffect(() => {
    const refetch = () => void getMyWorkspacesFn().then(setWorkspaces);
    window.addEventListener("osi:workspaces-changed", refetch);
    return () => window.removeEventListener("osi:workspaces-changed", refetch);
  }, []);

  if (workspaces.length === 0) return null;

  const active = workspaces.find((w) => w.active) ?? workspaces[0]!;
  const badge = cn(
    "flex max-w-[300px] items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-bold",
    TYPE_STYLES[active.type] ?? TYPE_STYLES["individual"],
  );

  // One workspace: a static badge — the user still always sees where they are.
  if (workspaces.length < 2) {
    return (
      <span className={badge} title={t(`workspaceTypes.${active.type}`)}>
        <TypeIcon type={active.type} />
        <span className="truncate">{active.name}</span>
      </span>
    );
  }

  const switchTo = async (workspace: WorkspaceSummary) => {
    if (workspace.active || switching) return;
    setSwitching(true);
    try {
      await authClient.organization.setActive({ organizationId: workspace.id });
      // Land on the dashboard of the new workspace: staying on a detail page
      // of the old one would 404-or-refuse after the re-scope.
      await router.navigate({ to: "/" });
      await router.invalidate();
      setWorkspaces(await getMyWorkspacesFn());
    } finally {
      setSwitching(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t("topbar.switchWorkspace")}
        disabled={switching}
        className={cn(badge, "transition-opacity hover:opacity-90")}
        title={t(`workspaceTypes.${active.type}`)}
      >
        <TypeIcon type={active.type} />
        <span className="truncate">{active.name}</span>
        <ChevronsUpDown className="size-3.5 shrink-0 opacity-70" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {workspaces.map((workspace) => (
          <DropdownMenuItem
            key={workspace.id}
            onSelect={() => void switchTo(workspace)}
            className="flex items-center justify-between gap-3"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <TypeIcon type={workspace.type} />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{workspace.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {t(`workspaceTypes.${workspace.type}`)} ·{" "}
                  {t(`workspaceRoles.${workspace.role}`, { defaultValue: workspace.role })}
                </span>
              </span>
            </span>
            {workspace.active && <Check className="size-4 shrink-0 text-gold" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
