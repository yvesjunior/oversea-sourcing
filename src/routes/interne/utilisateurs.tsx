// Platform user management — the INTERNAL OSI team only (rescoped
// 2026-08-27: customer people belong to their own workspace; customer
// ACCOUNTS + plan assignment live on /interne/clients).

import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { requirePlatformFeature } from "@/lib/auth-guard";
import { getPlatformUsersFn, type PlatformUserView } from "@/lib/user-admin-fns";

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

function Utilisateurs() {
  const { t, i18n } = useTranslation();
  const { users } = Route.useLoaderData();

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
                    <RoleBadge role={user.platformRole} />
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
