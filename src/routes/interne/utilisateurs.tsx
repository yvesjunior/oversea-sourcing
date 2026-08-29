// Platform user management — the INTERNAL OSI team only (rescoped
// 2026-08-27: customer people belong to their own workspace; customer
// ACCOUNTS + plan assignment live on /interne/clients).

import { useEffect, useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requirePlatformFeature } from "@/lib/auth-guard";
import {
  createStaffRoleFn,
  deleteStaffRoleFn,
  getAssignableRolesFn,
  getPermissionMatrixFn,
  updatePermissionFn,
  type PermissionMatrix,
  type StaffRole,
} from "@/lib/permission-fns";
import { getPlatformUsersFn, setPlatformRoleFn, type PlatformUserView } from "@/lib/user-admin-fns";
import { formatDay } from "@/lib/instant";

export const Route = createFileRoute("/interne/utilisateurs")({
  beforeLoad: ({ context }) => requirePlatformFeature(context.session, "users"),
  head: () => ({ meta: [{ title: "Utilisateurs | OSI" }] }),
  loader: async () => ({ users: await getPlatformUsersFn() }),
  component: Utilisateurs,
});

function RoleBadge({ role }: { role: string }) {
  const { t } = useTranslation();
  const isStaff = role !== "user";
  return (
    <span
      className={
        isStaff
          ? "rounded-full bg-gold-gradient px-2 py-0.5 text-[10px] font-semibold text-gold-foreground"
          : "rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-muted-foreground"
      }
    >
      {t(`platformRoles.${role}`, { defaultValue: role })}
    </span>
  );
}

/** Grant a platform role by email (owner-exclusive): granting also enrolls
 *  the person into the OSI internal workspace — the ②b follow-up closed. */
function GrantRolePanel({ onChanged, roles }: { onChanged: () => void; roles: StaffRole[] }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("manager");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"idle" | "done" | "not_found" | "self" | "failed">("idle");

  const grant = async () => {
    setBusy(true);
    setStatus("idle");
    try {
      const result = await setPlatformRoleFn({ data: { email, role } });
      if (!result.ok) {
        setStatus(
          result.error === "not_found" || result.error === "self" ? result.error : "failed",
        );
        return;
      }
      setStatus("done");
      setEmail("");
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card-surface p-6">
      <p className="text-sm font-semibold">{t("usersAdmin.grantTitle")}</p>
      <p className="mt-1 text-xs text-muted-foreground">{t("usersAdmin.grantHint")}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Input
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setStatus("idle");
          }}
          placeholder="personne@entreprise.com"
          className="h-9 max-w-xs"
        />
        <select
          aria-label={t("usersAdmin.platformRole")}
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          {/* Built-ins plus whatever the owner created (Phase R) — a role
              that cannot be assigned is a role that does nothing. */}
          {roles.map((option) => (
            <option key={option.name} value={option.name}>
              {option.builtIn
                ? t(`platformRoles.${option.name}`, { defaultValue: option.label })
                : option.label}
            </option>
          ))}
          <option value="owner">{t("platformRoles.owner")}</option>
        </select>
        <Button size="sm" disabled={busy || !email.includes("@")} onClick={() => void grant()}>
          {t("usersAdmin.grantButton")}
        </Button>
        {status === "done" && (
          <span className="text-xs text-emerald-600">{t("usersAdmin.grantDone")}</span>
        )}
        {status === "not_found" && (
          <span className="text-xs text-destructive">{t("usersAdmin.grantNotFound")}</span>
        )}
        {status === "self" && (
          <span className="text-xs text-destructive">{t("usersAdmin.grantSelf")}</span>
        )}
        {status === "failed" && (
          <span className="text-xs text-destructive">{t("usersAdmin.grantFailed")}</span>
        )}
      </div>
    </section>
  );
}

/** Rôles & accès (owner request 2026-08-28; roles became data in Phase R,
 *  2026-08-29) — what each STAFF role may do, as live switches, plus the
 *  owner's own roles beside the two built-ins. The owner column is not here on
 *  purpose: the owner always has everything, so the matrix cannot lock its own
 *  editor out, and creating a role is owner-only forever — a role that could
 *  grant roles could promote itself. */
function RolesAccessPanel() {
  const { t } = useTranslation();
  const [matrix, setMatrix] = useState<PermissionMatrix>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [roleError, setRoleError] = useState<string | null>(null);

  const reload = () => void getPermissionMatrixFn().then(setMatrix);
  useEffect(reload, []);

  if (!matrix) return <p className="text-sm text-muted-foreground">…</p>;

  const toggle = async (feature: string, role: string, enabled: boolean) => {
    setBusyKey(`${role}:${feature}`);
    try {
      const result = await updatePermissionFn({ data: { feature, role, enabled } });
      if (result.ok) {
        setMatrix((current) =>
          current
            ? {
                ...current,
                grants: {
                  ...current.grants,
                  [role]: { ...current.grants[role], [feature]: enabled },
                },
              }
            : current,
        );
      }
    } finally {
      setBusyKey(null);
    }
  };

  const createRole = async () => {
    setRoleError(null);
    setBusyKey("new-role");
    try {
      const result = await createStaffRoleFn({ data: { label: newLabel.trim() } });
      if (result.ok) {
        setNewLabel("");
        reload();
      } else {
        setRoleError(t(`permissions.roleError.${result.reason}`));
      }
    } finally {
      setBusyKey(null);
    }
  };

  const removeRole = async (name: string) => {
    setRoleError(null);
    setBusyKey(`del:${name}`);
    try {
      const result = await deleteStaffRoleFn({ data: { name } });
      if (result.ok) reload();
      // A role someone still holds is not deleted from under them: the owner
      // reassigns those accounts first, on the list above.
      else
        setRoleError(t(`permissions.roleError.${result.reason}`, { count: result.holders ?? 0 }));
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <section className="card-surface p-6">
      <p className="text-sm font-semibold">{t("permissions.title")}</p>
      <p className="mt-1 text-xs text-muted-foreground">{t("permissions.hint")}</p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="pb-2 pr-4 font-medium">{t("permissions.capability")}</th>
              <th className="pb-2 pr-4 font-medium">{t("platformRoles.owner")}</th>
              {matrix.roles.map((role) => (
                <th key={role.name} className="pb-2 pr-4 font-medium">
                  <span className="flex items-center gap-1.5">
                    {role.builtIn
                      ? t(`platformRoles.${role.name}`, { defaultValue: role.label })
                      : role.label}
                    {!role.builtIn && (
                      <button
                        type="button"
                        title={t("permissions.deleteRole")}
                        aria-label={`${t("permissions.deleteRole")} — ${role.label}`}
                        disabled={busyKey === `del:${role.name}`}
                        onClick={() => void removeRole(role.name)}
                        className="text-muted-foreground transition-colors hover:text-destructive"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.keys.map((key) => (
              <tr key={key} className="border-b border-border/60">
                <td className="py-2.5 pr-4">
                  {t(`permissions.keys.${key}`, { defaultValue: key })}
                </td>
                <td className="py-2.5 pr-4 text-xs text-muted-foreground">
                  {t("permissions.always")}
                </td>
                {matrix.roles.map((role) => (
                  <td key={role.name} className="py-2.5 pr-4">
                    <Switch
                      checked={matrix.grants[role.name]?.[key] ?? false}
                      disabled={busyKey === `${role.name}:${key}`}
                      aria-label={`${t(`permissions.keys.${key}`, { defaultValue: key })} — ${role.label}`}
                      onCheckedChange={(enabled) => void toggle(key, role.name, enabled)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Creating a role grants NOTHING — the switches above are how it gets
          its access, one deliberate flip at a time. */}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder={t("permissions.newRolePlaceholder")}
          className="h-9 w-[220px] text-xs"
          maxLength={40}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={newLabel.trim().length < 2 || busyKey === "new-role"}
          onClick={() => void createRole()}
        >
          <Plus className="size-3.5" />
          {t("permissions.addRole")}
        </Button>
        <span className="text-xs text-muted-foreground">{t("permissions.newRoleHint")}</span>
      </div>
      {roleError && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {roleError}
        </p>
      )}
      <p className="mt-3 text-xs text-muted-foreground">{t("permissions.note")}</p>
    </section>
  );
}

function Utilisateurs() {
  const { t, i18n } = useTranslation();
  const { users } = Route.useLoaderData();
  const { session } = Route.useRouteContext();
  const router = useRouter();
  const refresh = () => void router.invalidate();
  const viewerRole = (session?.user as { platformRole?: string } | undefined)?.platformRole;
  const viewerEmail = session?.user?.email;
  const isPlatformOwner = viewerRole === "owner";
  // The assignable set is data since Phase R, so it is fetched rather than
  // hardcoded in two dropdowns that would drift apart.
  const [roles, setRoles] = useState<StaffRole[]>([]);
  useEffect(() => {
    void getAssignableRolesFn().then(setRoles);
  }, []);

  const changeRole = async (user: PlatformUserView, role: string) => {
    if (!window.confirm(t("usersAdmin.roleConfirm", { name: user.name, role }))) return;
    const result = await setPlatformRoleFn({
      data: { email: user.email, role: role as "user" | "owner" | "manager" | "accountant" },
    });
    if (result.ok) refresh();
  };

  const stamp = (iso: string) => formatDay(iso, i18n.language);

  return (
    <div className="space-y-6 pt-6">
      <header>
        <h1 className="font-display text-2xl font-semibold">{t("usersAdmin.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("usersAdmin.subtitle", { count: users.length })}
        </p>
      </header>

      <Tabs defaultValue="equipe">
        {isPlatformOwner && (
          <TabsList>
            <TabsTrigger value="equipe" className="py-1">
              {t("usersAdmin.tabTeam")}
            </TabsTrigger>
            <TabsTrigger value="acces" className="py-1">
              {t("usersAdmin.tabAccess")}
            </TabsTrigger>
          </TabsList>
        )}
        <TabsContent value="equipe" className="mt-3 space-y-6">
          {isPlatformOwner && <GrantRolePanel onChanged={refresh} roles={roles} />}

          <section className="card-surface p-6">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="pb-2 pr-4 font-medium">{t("usersAdmin.user")}</th>
                    <th className="pb-2 pr-4 font-medium">{t("usersAdmin.platformRole")}</th>
                    <th className="pb-2 pr-4 font-medium">{t("usersAdmin.workspace")}</th>
                    <th className="pb-2 pr-4 font-medium">{t("usersAdmin.usedToday")}</th>
                    <th className="pb-2 pr-4 font-medium">{t("usersAdmin.usedTotal")}</th>
                    <th className="pb-2 font-medium">{t("usersAdmin.joined")}</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user: PlatformUserView) => (
                    <tr key={user.userId} className="border-b border-border/60">
                      <td className="py-2.5 pr-4">
                        <p className="font-medium">{user.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {user.email}
                          {user.emailVerified && (
                            <span className="ml-1 text-gold" title={t("usersAdmin.verified")}>
                              ✓
                            </span>
                          )}
                        </p>
                      </td>
                      <td className="py-2.5 pr-4">
                        {isPlatformOwner && user.email !== viewerEmail ? (
                          <select
                            aria-label={t("usersAdmin.platformRole")}
                            value={user.platformRole}
                            onChange={(e) => void changeRole(user, e.target.value)}
                            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                          >
                            <option value="owner">{t("platformRoles.owner")}</option>
                            {roles.map((option) => (
                              <option key={option.name} value={option.name}>
                                {option.builtIn
                                  ? t(`platformRoles.${option.name}`, {
                                      defaultValue: option.label,
                                    })
                                  : option.label}
                              </option>
                            ))}
                            <option value="user">{t("usersAdmin.revokeOption")}</option>
                          </select>
                        ) : (
                          <RoleBadge role={user.platformRole} />
                        )}
                      </td>
                      <td className="py-2.5 pr-4 text-muted-foreground">
                        {user.workspaceName ?? "—"}
                      </td>
                      <td className="py-2.5 pr-4 tabular-nums text-muted-foreground">
                        {user.usedToday}
                      </td>
                      <td className="py-2.5 pr-4 tabular-nums text-muted-foreground">
                        {user.usedTotal}
                      </td>
                      <td className="py-2.5 text-xs text-muted-foreground">
                        {stamp(user.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </TabsContent>
        {isPlatformOwner && (
          <TabsContent value="acces" className="mt-3">
            <RolesAccessPanel />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
