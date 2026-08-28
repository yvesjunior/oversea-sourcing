// Platform user management — the INTERNAL OSI team only (rescoped
// 2026-08-27: customer people belong to their own workspace; customer
// ACCOUNTS + plan assignment live on /interne/clients).

import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { requirePlatformFeature } from "@/lib/auth-guard";
import { getAuditLogFn, type AuditLogData } from "@/lib/audit-fns";
import { getPlatformUsersFn, type PlatformUserView } from "@/lib/user-admin-fns";

export const Route = createFileRoute("/interne/utilisateurs")({
  beforeLoad: ({ context }) => requirePlatformFeature(context.session, "users"),
  head: () => ({ meta: [{ title: "Utilisateurs | OSI" }] }),
  loader: async () => ({ users: await getPlatformUsersFn() }),
  // The audit journal loads client-side (filterable per org / per user).
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

/** The audit journal (owner request 2026-08-27) — every lifecycle/admin
 *  action, filterable PER ORG and PER USER. Writes: src/server/audit.ts. */
function AuditJournal() {
  const { t, i18n } = useTranslation();
  const [data, setData] = useState<AuditLogData | null>(null);
  const [orgFilter, setOrgFilter] = useState("");
  const [actorFilter, setActorFilter] = useState("");

  useEffect(() => {
    void getAuditLogFn({
      data: {
        ...(orgFilter ? { organizationId: orgFilter } : {}),
        ...(actorFilter ? { actorId: actorFilter } : {}),
      },
    }).then(setData);
  }, [orgFilter, actorFilter]);

  const stamp = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language, { dateStyle: "short", timeStyle: "short" });

  return (
    <section className="card-surface p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{t("auditAdmin.title")}</h2>
        <span className="flex flex-wrap gap-2">
          <select
            aria-label={t("auditAdmin.filterOrg")}
            value={orgFilter}
            onChange={(e) => setOrgFilter(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          >
            <option value="">{t("auditAdmin.allOrgs")}</option>
            {(data?.filters.organizations ?? []).map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
          <select
            aria-label={t("auditAdmin.filterActor")}
            value={actorFilter}
            onChange={(e) => setActorFilter(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
          >
            <option value="">{t("auditAdmin.allActors")}</option>
            {(data?.filters.actors ?? []).map((actor) => (
              <option key={actor.id} value={actor.id}>
                {actor.name}
              </option>
            ))}
          </select>
        </span>
      </div>
      {!data || data.rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("auditAdmin.empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="pb-2 pr-4 font-medium">{t("auditAdmin.when")}</th>
                <th className="pb-2 pr-4 font-medium">{t("auditAdmin.actor")}</th>
                <th className="pb-2 pr-4 font-medium">{t("auditAdmin.action")}</th>
                <th className="pb-2 pr-4 font-medium">{t("auditAdmin.target")}</th>
                <th className="pb-2 font-medium">{t("auditAdmin.workspace")}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.id} className="border-b border-border/60">
                  <td className="py-2 pr-4 text-xs text-muted-foreground">{stamp(row.at)}</td>
                  <td className="py-2 pr-4 text-xs">{row.actorName ?? "—"}</td>
                  <td className="py-2 pr-4">
                    <span
                      className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold"
                      title={row.detail ? JSON.stringify(row.detail) : undefined}
                    >
                      {t(`auditActions.${row.action}`, { defaultValue: row.action })}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-xs">{row.target ?? "—"}</td>
                  <td className="py-2 text-xs text-muted-foreground">
                    {row.organizationName ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
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

      <AuditJournal />
    </div>
  );
}
