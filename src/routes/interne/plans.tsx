import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requirePlatformFeature } from "@/lib/auth-guard";
import {
  assignPlanFn,
  getPlanAdminFn,
  updatePlanFn,
  type PlanAdminData,
  type PlanView,
} from "@/lib/plan-fns";
import { MODEL_TIERS, type ModelTier } from "@/database/schema";

/** What one request costs at each tier — measured 2026-08-16, see the README.
 *  Shown next to the limits because "requests per day" is a cost commitment,
 *  and a form that hides the money is a footgun with a number in it. */
const COST_PER_REQUEST: Record<ModelTier, number> = {
  cheap: 0.06,
  balanced: 0.21,
  best: 0.2,
};

export const Route = createFileRoute("/interne/plans")({
  beforeLoad: ({ context }) => requirePlatformFeature(context.session, "plans"),
  head: () => ({ meta: [{ title: "Forfaits | OSI" }] }),
  loader: async (): Promise<PlanAdminData> => await getPlanAdminFn(),
  component: Plans,
});

function PlanCard({ plan, onSaved }: { plan: PlanView; onSaved: () => void }) {
  const { t } = useTranslation();
  const [requestsPerDay, setRequestsPerDay] = useState(plan.requestsPerDay);
  const [suppliersReturned, setSuppliersReturned] = useState(plan.suppliersReturned);
  const [modelTier, setModelTier] = useState<ModelTier>(plan.modelTier);
  const [saving, setSaving] = useState(false);

  const dirty =
    requestsPerDay !== plan.requestsPerDay ||
    suppliersReturned !== plan.suppliersReturned ||
    modelTier !== plan.modelTier;

  const dailyCost = requestsPerDay * COST_PER_REQUEST[modelTier];

  const save = async () => {
    setSaving(true);
    try {
      await updatePlanFn({ data: { id: plan.id, requestsPerDay, suppliersReturned, modelTier } });
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className="card-surface p-5">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-bold">{plan.name}</h2>
          <p className="truncate text-[11px] text-muted-foreground">
            {t("plans.workspacesOn", { count: plan.workspaces })}
          </p>
        </div>
        <code className="shrink-0 rounded bg-secondary px-2 py-0.5 text-[10px] font-semibold">
          {plan.code}
        </code>
      </header>

      <div className="mt-4 space-y-3">
        <div className="grid grid-cols-[minmax(0,1fr)_88px] items-center gap-3">
          <Label htmlFor={`req-${plan.id}`} className="text-xs text-muted-foreground">
            {t("plans.requestsPerDay")}
          </Label>
          <Input
            id={`req-${plan.id}`}
            type="number"
            min={0}
            max={500}
            value={requestsPerDay}
            onChange={(e) => setRequestsPerDay(Number(e.target.value))}
            className="h-8 text-right tabular-nums"
          />
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_88px] items-center gap-3">
          <Label htmlFor={`sup-${plan.id}`} className="text-xs text-muted-foreground">
            {t("plans.suppliersReturned")}
          </Label>
          <Input
            id={`sup-${plan.id}`}
            type="number"
            min={1}
            max={20}
            value={suppliersReturned}
            onChange={(e) => setSuppliersReturned(Number(e.target.value))}
            className="h-8 text-right tabular-nums"
          />
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <Label htmlFor={`tier-${plan.id}`} className="text-xs text-muted-foreground">
            {t("plans.modelTier")}
          </Label>
          <select
            id={`tier-${plan.id}`}
            value={modelTier}
            onChange={(e) => setModelTier(e.target.value as ModelTier)}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          >
            {MODEL_TIERS.map((tier) => (
              <option key={tier} value={tier}>
                {tier}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* The money this commits, recomputed as you type. */}
      <p className="mt-4 rounded-lg bg-secondary px-3 py-2 text-[11px] text-muted-foreground">
        {requestsPerDay === 0
          ? t("plans.costUnlimited")
          : t("plans.costEstimate", {
              cost: dailyCost.toFixed(2),
              month: (dailyCost * 30).toFixed(0),
            })}
      </p>

      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <span className="truncate text-[10px] text-muted-foreground">
          {plan.updatedByName ? t("plans.lastChangedBy", { name: plan.updatedByName }) : ""}
        </span>
        <Button size="sm" disabled={!dirty || saving} onClick={() => void save()}>
          {t("plans.save")}
        </Button>
      </div>
    </article>
  );
}

function Plans() {
  const { t } = useTranslation();
  const router = useRouter();
  const { plans, workspaces } = Route.useLoaderData();
  const refresh = () => void router.invalidate();

  return (
    <div className="space-y-6 pt-6">
      <header>
        <h1 className="font-display text-2xl font-semibold">{t("plans.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("plans.subtitle")}</p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {plans.map((plan) => (
          <PlanCard key={plan.id} plan={plan} onSaved={refresh} />
        ))}
      </section>

      <section className="card-surface p-6">
        <h2 className="text-base font-semibold">{t("plans.workspacesTitle")}</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="pb-2 pr-4 font-medium">{t("plans.workspace")}</th>
                <th className="pb-2 pr-4 font-medium">{t("plans.usedToday")}</th>
                <th className="pb-2 font-medium">{t("plans.plan")}</th>
              </tr>
            </thead>
            <tbody>
              {workspaces.map((w) => (
                <tr key={w.organizationId} className="border-b border-border/60">
                  <td className="py-2 pr-4">{w.organizationName}</td>
                  <td className="py-2 pr-4 tabular-nums text-muted-foreground">{w.usedToday}</td>
                  <td className="py-2">
                    <select
                      aria-label={t("plans.plan")}
                      value={w.planCode}
                      onChange={(e) => {
                        void assignPlanFn({
                          data: { organizationId: w.organizationId, planCode: e.target.value },
                        }).then(refresh);
                      }}
                      className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                    >
                      {w.planCode === "—" && <option value="—">—</option>}
                      {plans.map((p) => (
                        <option key={p.code} value={p.code}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
