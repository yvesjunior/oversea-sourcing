// Platform user management — the INTERNAL OSI team only (rescoped
// 2026-08-27: customer people belong to their own workspace; customer
// ACCOUNTS + plan assignment live on /interne/clients).

import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requirePlatformFeature } from "@/lib/auth-guard";
import { getPlatformUsersFn, setPlatformRoleFn, type PlatformUserView } from "@/lib/user-admin-fns";

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
function GrantRolePanel({ onChanged }: { onChanged: () => void }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("manager");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<"idle" | "done" | "not_found" | "self" | "failed">("idle");

  const grant = async () => {
    setBusy(true);
    setStatus("idle");
    try {
      const result = await setPlatformRoleFn({
        data: { email, role: role as "owner" | "manager" | "accountant" },
      });
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
          <option value="manager">{t("platformRoles.manager")}</option>
          <option value="accountant">{t("platformRoles.accountant")}</option>
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

function Utilisateurs() {
  const { t, i18n } = useTranslation();
  const { users } = Route.useLoaderData();
  const { session } = Route.useRouteContext();
  const router = useRouter();
  const refresh = () => void router.invalidate();
  const viewerRole = (session?.user as { platformRole?: string } | undefined)?.platformRole;
  const viewerEmail = session?.user?.email;
  const isPlatformOwner = viewerRole === "owner";

  const changeRole = async (user: PlatformUserView, role: string) => {
    if (!window.confirm(t("usersAdmin.roleConfirm", { name: user.name, role }))) return;
    const result = await setPlatformRoleFn({
      data: { email: user.email, role: role as "user" | "owner" | "manager" | "accountant" },
    });
    if (result.ok) refresh();
  };

  const stamp = (iso: string) =>
    new Date(iso).toLocaleDateString(i18n.language, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

  return (
    <div className="space-y-6 pt-6">
      <header>
        <h1 className="font-display text-2xl font-semibold">{t("usersAdmin.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("usersAdmin.subtitle", { count: users.length })}
        </p>
      </header>

      {isPlatformOwner && <GrantRolePanel onChanged={refresh} />}

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
                        <option value="manager">{t("platformRoles.manager")}</option>
                        <option value="accountant">{t("platformRoles.accountant")}</option>
                        <option value="user">{t("usersAdmin.revokeOption")}</option>
                      </select>
                    ) : (
                      <RoleBadge role={user.platformRole} />
                    )}
                  </td>
                  <td className="py-2.5 pr-4 text-muted-foreground">{user.workspaceName ?? "—"}</td>
                  <td className="py-2.5 pr-4 tabular-nums text-muted-foreground">
                    {user.usedToday}
                  </td>
                  <td className="py-2.5 pr-4 tabular-nums text-muted-foreground">
                    {user.usedTotal}
                  </td>
                  <td className="py-2.5 text-xs text-muted-foreground">{stamp(user.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
