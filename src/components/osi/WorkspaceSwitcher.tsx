// Workspace switcher (B2, 2026-08-23) — where the user is "standing".
//
// Renders nothing for the common case (one workspace): individuals never see
// machinery they don't need. With several memberships it shows the active
// workspace and lets the user move; the active organization lives in the
// SESSION (better-auth org plugin), so every server fn re-scopes on the next
// call — the switch itself never carries data across.

import { useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { Building2, Check, ChevronsUpDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { authClient } from "@/lib/auth-client";
import { getMyWorkspacesFn, type WorkspaceSummary } from "@/lib/workspace-fns";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function WorkspaceSwitcher() {
  const { t } = useTranslation();
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    void getMyWorkspacesFn().then(setWorkspaces);
  }, []);

  // One workspace (or anonymous): no machinery to show.
  if (workspaces.length < 2) return null;

  const active = workspaces.find((w) => w.active) ?? workspaces[0]!;

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
        className="flex max-w-[220px] items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold transition-colors hover:text-foreground"
      >
        <Building2 className="size-3.5 shrink-0" />
        <span className="truncate">{active.name}</span>
        <ChevronsUpDown className="size-3 shrink-0 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {workspaces.map((workspace) => (
          <DropdownMenuItem
            key={workspace.id}
            onSelect={() => void switchTo(workspace)}
            className="flex items-center justify-between gap-3"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm">{workspace.name}</span>
              <span className="block text-xs text-muted-foreground">
                {t(`workspaceRoles.${workspace.role}`, { defaultValue: workspace.role })}
              </span>
            </span>
            {workspace.active && <Check className="size-4 shrink-0 text-gold" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
