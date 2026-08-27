// Customer accounts (staff view, 2026-08-26/27) — the account-centric
// counterpart of /interne/utilisateurs (which lists the INTERNAL team
// only): every customer workspace, split by account type, with owner,
// plan, seats and lifetime usage. PLAN ASSIGNMENT lives here (an account
// action, audience-filtered; assignPlanFn enforces server-side too).

import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Briefcase } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptySection } from "@/components/osi/EmptySection";
import { requirePlatformFeature } from "@/lib/auth-guard";
import { assignPlanFn, getPlanAdminFn } from "@/lib/plan-fns";
import { getCustomerAccountsFn, type CustomerAccountView } from "@/lib/client-admin-fns";

export const Route = createFileRoute("/interne/clients")({
  head: () => ({
    meta: [{ title: "Clients | OSI" }, { name: "robots", content: "noindex" }],
  }),
  beforeLoad: ({ context }) => {
    requirePlatformFeature(context.session, "clients");
  },
  loader: async () => {
    const [accounts, planAdmin] = await Promise.all([getCustomerAccountsFn(), getPlanAdminFn()]);
    return { accounts, plans: planAdmin.plans };
  },
  component: ClientsScreen,
});

const TAB_TRIGGER =
  "py-1 data-[state=active]:bg-gold-gradient data-[state=active]:text-gold-foreground data-[state=active]:shadow-gold";

type PlanOption = { code: string; name: string; audience: string };

function AccountsTable({
  accounts,
  plans,
  onChanged,
}: {
  accounts: CustomerAccountView[];
  plans: PlanOption[];
  onChanged: () => void;
}) {
  const { t, i18n } = useTranslation();

  if (accounts.length === 0) {
    return <p className="py-6 text-sm text-muted-foreground">{t("clientsAdmin.emptyTab")}</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th className="pb-2 pr-4 font-medium">{t("clientsAdmin.account")}</th>
            <th className="pb-2 pr-4 font-medium">{t("clientsAdmin.owner")}</th>
            <th className="pb-2 pr-4 font-medium">{t("clientsAdmin.plan")}</th>
            <th className="pb-2 pr-4 font-medium">{t("clientsAdmin.members")}</th>
            <th className="pb-2 pr-4 font-medium">{t("clientsAdmin.requests")}</th>
            <th className="pb-2 font-medium">{t("clientsAdmin.since")}</th>
          </tr>
        </thead>
        <tbody>
          {accounts.map((account) => (
            <tr key={account.id} className="border-b border-border/60">
              <td className="py-3 pr-4 font-medium">{account.name}</td>
              <td className="py-3 pr-4">
                <p className="text-sm">{account.ownerName ?? "—"}</p>
                {account.ownerEmail && (
                  <p className="text-xs text-muted-foreground">{account.ownerEmail}</p>
                )}
              </td>
              <td className="py-3 pr-4">
                {/* Plan assignment lives HERE now (2026-08-27) — it is an
                    ACCOUNT action; options are audience-compatible with the
                    account type (assignPlanFn enforces it server-side too). */}
                <select
                  aria-label={t("clientsAdmin.plan")}
                  value={account.planCode ?? "—"}
                  onChange={(e) => {
                    void assignPlanFn({
                      data: { organizationId: account.id, planCode: e.target.value },
                    }).then(onChanged);
                  }}
                  className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                >
                  {!account.planCode && <option value="—">—</option>}
                  {plans
                    .filter((p) =>
                      account.type === "enterprise"
                        ? p.audience !== "individual"
                        : p.audience !== "organization",
                    )
                    .map((p) => (
                      <option key={p.code} value={p.code}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </td>
              <td className="py-3 pr-4 text-xs tabular-nums">{account.members}</td>
              <td className="py-3 pr-4 text-xs tabular-nums">{account.requestsTotal}</td>
              <td className="py-3 text-xs text-muted-foreground">
                {new Date(account.createdAt).toLocaleDateString(i18n.language, {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ClientsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { accounts, plans } = Route.useLoaderData();
  const refresh = () => void router.invalidate();
  const individuals = accounts.filter((a) => a.type === "individual");
  const enterprises = accounts.filter((a) => a.type === "enterprise");

  if (accounts.length === 0) {
    return (
      <EmptySection icone={Briefcase} titleKey="clientsAdmin.title" textKey="clientsAdmin.empty" />
    );
  }

  return (
    <div className="space-y-6 pt-6">
      <header>
        <h1 className="font-display text-2xl font-semibold">{t("clientsAdmin.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("clientsAdmin.subtitle")}</p>
      </header>

      <Tabs defaultValue="individual">
        <TabsList>
          <TabsTrigger value="individual" className={TAB_TRIGGER}>
            {t("clientsAdmin.tabIndividual", { count: individuals.length })}
          </TabsTrigger>
          <TabsTrigger value="enterprise" className={TAB_TRIGGER}>
            {t("clientsAdmin.tabEnterprise", { count: enterprises.length })}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="individual" className="mt-3">
          <section className="card-surface p-6">
            <AccountsTable accounts={individuals} plans={plans} onChanged={refresh} />
          </section>
        </TabsContent>
        <TabsContent value="enterprise" className="mt-3">
          <section className="card-surface p-6">
            <AccountsTable accounts={enterprises} plans={plans} onChanged={refresh} />
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}
