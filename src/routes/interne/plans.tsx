import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requirePlatformFeature } from "@/lib/auth-guard";
import {
  getPlanAdminFn,
  updatePlanFn,
  type PlanAdminData,
  type PlanAudience,
  type PlanView,
} from "@/lib/plan-fns";
import { MODEL_TIERS, type ModelTier } from "@/database/schema";

/** Tab order on the Abonnements screen (decided 2026-08-23). */
const AUDIENCES: PlanAudience[] = ["individual", "organization", "internal"];

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
  head: () => ({ meta: [{ title: "Abonnements | OSI" }] }),
  loader: async (): Promise<PlanAdminData> => await getPlanAdminFn(),
  component: Plans,
});

function PlanCard({ plan, onSaved }: { plan: PlanView; onSaved: () => void }) {
  const { t } = useTranslation();
  const [requestsPerDay, setRequestsPerDay] = useState(plan.requestsPerDay);
  const [maxRequestsTotal, setMaxRequestsTotal] = useState(plan.maxRequestsTotal);
  const [maxMembers, setMaxMembers] = useState(plan.maxMembers);
  const [quotaScope, setQuotaScope] = useState<"workspace" | "user">(plan.quotaScope);
  const [suppliersReturned, setSuppliersReturned] = useState(plan.suppliersReturned);
  const [modelTier, setModelTier] = useState<ModelTier>(plan.modelTier);
  const [saving, setSaving] = useState(false);

  const dirty =
    requestsPerDay !== plan.requestsPerDay ||
    maxRequestsTotal !== plan.maxRequestsTotal ||
    maxMembers !== plan.maxMembers ||
    quotaScope !== plan.quotaScope ||
    suppliersReturned !== plan.suppliersReturned ||
    modelTier !== plan.modelTier;

  const dailyCost = requestsPerDay * COST_PER_REQUEST[modelTier];

  const save = async () => {
    setSaving(true);
    try {
      await updatePlanFn({
        data: {
          id: plan.id,
          requestsPerDay,
          maxRequestsTotal,
          maxMembers,
          quotaScope,
          suppliersReturned,
          modelTier,
        },
      });
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
          <Label htmlFor={`tot-${plan.id}`} className="text-xs text-muted-foreground">
            {t("plans.maxRequestsTotal")}
          </Label>
          <Input
            id={`tot-${plan.id}`}
            type="number"
            min={0}
            max={500}
            value={maxRequestsTotal}
            onChange={(e) => setMaxRequestsTotal(Number(e.target.value))}
            className="h-8 text-right tabular-nums"
          />
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_88px] items-center gap-3">
          <Label htmlFor={`seats-${plan.id}`} className="text-xs text-muted-foreground">
            {t("plans.maxMembers")}
          </Label>
          <Input
            id={`seats-${plan.id}`}
            type="number"
            min={0}
            max={500}
            value={maxMembers}
            onChange={(e) => setMaxMembers(Number(e.target.value))}
            className="h-8 text-right tabular-nums"
          />
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
          <Label htmlFor={`scope-${plan.id}`} className="text-xs text-muted-foreground">
            {t("plans.quotaScope")}
          </Label>
          <select
            id={`scope-${plan.id}`}
            value={quotaScope}
            onChange={(e) => setQuotaScope(e.target.value as "workspace" | "user")}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="user">{t("plans.scopeUser")}</option>
            <option value="workspace">{t("plans.scopeWorkspace")}</option>
          </select>
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
  const { plans } = Route.useLoaderData();
  const refresh = () => void router.invalidate();

  return (
    <div className="space-y-6 pt-6">
      <header>
        <h1 className="font-display text-2xl font-semibold">{t("plans.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("plans.subtitle")}</p>
      </header>

      {/* One tab per audience (decided 2026-08-23): Individuel / Organisation /
          Interne — plan.audience drives both the tab and, later, which
          workspaces a plan may be assigned to. */}
      <Tabs defaultValue="individual">
        <TabsList>
          {AUDIENCES.map((audience) => (
            <TabsTrigger
              key={audience}
              value={audience}
              className="py-1 data-[state=active]:bg-gold-gradient data-[state=active]:text-gold-foreground data-[state=active]:shadow-gold"
            >
              {t(
                audience === "individual"
                  ? "plans.tabIndividual"
                  : audience === "organization"
                    ? "plans.tabOrganization"
                    : "plans.tabInternal",
              )}
            </TabsTrigger>
          ))}
        </TabsList>
        {AUDIENCES.map((audience) => (
          <TabsContent key={audience} value={audience} className="mt-3">
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {plans
                .filter((plan) => plan.audience === audience)
                .map((plan) => (
                  <PlanCard key={plan.id} plan={plan} onSaved={refresh} />
                ))}
            </section>
          </TabsContent>
        ))}
      </Tabs>

      {/* Plan ASSIGNMENT moved to /interne/utilisateurs (2026-08-23): people
          are managed on the user screen; this screen edits what plans grant. */}
    </div>
  );
}
