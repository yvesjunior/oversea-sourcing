// Paramètres (B5, 2026-08-23) — one route, four panels:
//   Profil        every member — name + language, server-persisted
//   Abonnement    every member — the workspace's plan, limits and live usage
//                 (read-only mirror of what /interne/plans grants; upgrade CTA
//                 is "Contactez-nous" until billing lands)
//   Sourcing      owner edits, others read — activated sources + country origin
//   Utilisateurs  owner only — the member list (invite/create arrive with B3)

import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { STORAGE_KEY } from "@/i18n/config";
import { authClient } from "@/lib/auth-client";
import { transferOwnershipFn } from "@/lib/team-fns";
import {
  getSettingsFn,
  updateProfileFn,
  updateSourcingRulesFn,
  type SettingsData,
} from "@/lib/settings-fns";

export const Route = createFileRoute("/parametres")({
  head: () => ({ meta: [{ title: "Paramètres | OSI" }] }),
  loader: async (): Promise<SettingsData> => await getSettingsFn(),
  component: Parametres,
});

const TAB_TRIGGER =
  "py-1 data-[state=active]:bg-gold-gradient data-[state=active]:text-gold-foreground data-[state=active]:shadow-gold";

function ProfilPanel({ data, onSaved }: { data: NonNullable<SettingsData>; onSaved: () => void }) {
  const { t, i18n } = useTranslation();
  const [name, setName] = useState(data.profile.name);
  const [locale, setLocale] = useState(data.profile.locale as "fr" | "en");
  const [saving, setSaving] = useState(false);
  const [verifySent, setVerifySent] = useState(false);
  const dirty = name !== data.profile.name || locale !== data.profile.locale;

  const save = async () => {
    setSaving(true);
    try {
      const result = await updateProfileFn({ data: { name, locale } });
      if (result.ok) {
        // The language toggle persists to localStorage; keep both in sync so
        // the next visit (any device: server value, this device: local) agrees.
        void i18n.changeLanguage(locale);
        window.localStorage.setItem(STORAGE_KEY, locale);
        document.documentElement.lang = locale;
        onSaved();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card-surface max-w-xl space-y-4 p-6">
      <div className="grid gap-1.5">
        <Label htmlFor="profile-name">{t("settings.name")}</Label>
        <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="grid gap-1.5">
        <Label>{t("settings.email")}</Label>
        <Input value={data.profile.email} disabled className="text-muted-foreground" />
        {data.profile.emailVerified ? (
          <p className="text-xs text-gold">✓ {t("settings.emailVerified")}</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t("settings.emailUnverified")}{" "}
            <button
              type="button"
              disabled={verifySent}
              onClick={() => {
                void authClient
                  .sendVerificationEmail({ email: data.profile.email, callbackURL: "/" })
                  .then(() => setVerifySent(true));
              }}
              className="text-gold underline-offset-2 hover:underline disabled:opacity-60"
            >
              {verifySent ? t("settings.verifySent") : t("settings.resendVerification")}
            </button>
          </p>
        )}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="profile-locale">{t("settings.language")}</Label>
        <select
          id="profile-locale"
          value={locale}
          onChange={(e) => setLocale(e.target.value as "fr" | "en")}
          className="h-9 w-40 rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="fr">Français</option>
          <option value="en">English</option>
        </select>
      </div>
      <Button disabled={!dirty || saving} onClick={() => void save()}>
        {t("settings.save")}
      </Button>
    </section>
  );
}

function UsageBar({ used, limit }: { used: number; limit: number }) {
  const { t } = useTranslation();
  if (limit === 0) {
    return <p className="text-sm text-muted-foreground">{t("settings.unlimited")}</p>;
  }
  const pct = Math.min(100, Math.round((used / limit) * 100));
  return (
    <div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className={pct >= 100 ? "h-full bg-destructive" : "h-full bg-gold-gradient"}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1 text-xs tabular-nums text-muted-foreground">
        {used} / {limit}
      </p>
    </div>
  );
}

function AbonnementPanel({ data }: { data: NonNullable<SettingsData> }) {
  const { t } = useTranslation();
  const sub = data.subscription;
  return (
    <section className="card-surface max-w-xl space-y-5 p-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold">{sub.planName}</h2>
          <p className="text-xs text-muted-foreground">
            {t(sub.quotaScope === "user" ? "settings.scopeUser" : "settings.scopeWorkspace")}
          </p>
        </div>
        <code className="rounded bg-secondary px-2 py-0.5 text-[10px] font-semibold">
          {sub.planCode}
        </code>
      </header>

      <div className="space-y-4">
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            {t("settings.usageToday")}
          </p>
          <UsageBar used={sub.usedToday} limit={sub.requestsPerDay} />
        </div>
        {sub.maxRequestsTotal > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">
              {t("settings.usageTotal")}
            </p>
            <UsageBar used={sub.usedTotal} limit={sub.maxRequestsTotal} />
          </div>
        )}
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">{t("settings.seats")}</p>
          <UsageBar used={sub.seatsUsed} limit={sub.maxMembers} />
        </div>
        <p className="text-xs text-muted-foreground">
          {t("settings.suppliersPerReport", { count: sub.suppliersReturned })}
        </p>
      </div>

      {/* Self-service upgrade arrives with billing; until then the CTA is human. */}
      <a
        href="mailto:contact@osi-solutions.com?subject=Changement%20de%20forfait%20OSI"
        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
      >
        <Mail className="size-4" /> {t("settings.upgradeCta")}
      </a>
    </section>
  );
}

function SourcingPanel({
  data,
  onSaved,
}: {
  data: NonNullable<SettingsData>;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const isOwner = data.workspace.role === "owner";
  const all = data.sourcing.catalogue;
  const [activated, setActivated] = useState<Set<string>>(
    new Set(data.sourcing.activatedSourceIds ?? all.map((s) => s.id)),
  );
  const [countryMode, setCountryMode] = useState(data.sourcing.countryMode);
  const [countries, setCountries] = useState(data.sourcing.countryCodes.join(", "));
  const [saving, setSaving] = useState(false);

  const toggle = (id: string) => {
    setActivated((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      const codes = countries
        .split(/[\s,;]+/)
        .map((c) => c.trim().toUpperCase())
        .filter((c) => /^[A-Z]{2}$/.test(c));
      await updateSourcingRulesFn({
        data: {
          // Everything activated = store null (the default: future sources
          // arrive activated instead of silently excluded).
          activatedSourceIds: activated.size === all.length ? null : [...activated],
          countryMode,
          countryCodes: countryMode === "list" ? codes : [],
        },
      });
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card-surface max-w-xl space-y-5 p-6">
      {!isOwner && <p className="text-xs text-muted-foreground">{t("settings.ownerOnly")}</p>}

      <div>
        <p className="mb-2 text-sm font-semibold">{t("settings.sourcesTitle")}</p>
        <p className="mb-3 text-xs text-muted-foreground">{t("settings.sourcesHint")}</p>
        <div className="space-y-2">
          {all.map((source) => (
            <label key={source.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={activated.has(source.id)}
                onChange={() => toggle(source.id)}
                disabled={!isOwner}
                className="size-4 accent-[var(--gold)]"
              />
              {t(`sourceNames.${source.code}`, { defaultValue: source.name })}
            </label>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-sm font-semibold">{t("settings.originTitle")}</p>
        <div className="flex flex-col gap-2 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="country-mode"
              checked={countryMode === "global"}
              onChange={() => setCountryMode("global")}
              disabled={!isOwner}
              className="size-4 accent-[var(--gold)]"
            />
            {t("settings.originGlobal")}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="country-mode"
              checked={countryMode === "list"}
              onChange={() => setCountryMode("list")}
              disabled={!isOwner}
              className="size-4 accent-[var(--gold)]"
            />
            {t("settings.originList")}
          </label>
          {countryMode === "list" && (
            <Input
              value={countries}
              onChange={(e) => setCountries(e.target.value)}
              placeholder={t("settings.originPlaceholder")}
              disabled={!isOwner}
              className="mt-1 max-w-xs"
            />
          )}
        </div>
      </div>

      {isOwner && (
        <Button disabled={saving} onClick={() => void save()}>
          {t("settings.save")}
        </Button>
      )}
    </section>
  );
}

function MembersPanel({ data, onSaved }: { data: NonNullable<SettingsData>; onSaved: () => void }) {
  const { t } = useTranslation();
  const sub = data.subscription;
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"buyer" | "viewer">("buyer");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const act = async (run: () => Promise<{ error?: { message?: string } | null } | unknown>) => {
    setPending(true);
    setMessage(null);
    try {
      const result = (await run()) as { error?: { message?: string } | null } | undefined;
      if (result?.error) {
        setMessage(
          result.error.message === "SEAT_LIMIT_REACHED"
            ? t("settings.seatLimit")
            : t("settings.teamError"),
        );
        return;
      }
      onSaved();
    } finally {
      setPending(false);
    }
  };

  const invite = () =>
    act(async () => {
      const result = await authClient.organization.inviteMember({
        email: inviteEmail.trim(),
        role: inviteRole,
      });
      if (!result.error) setInviteEmail("");
      return result;
    });

  const copyLink = async (invitationId: string) => {
    await navigator.clipboard.writeText(`${window.location.origin}/invitation/${invitationId}`);
    setCopiedId(invitationId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <section className="card-surface max-w-2xl space-y-6 p-6">
      <p className="text-xs text-muted-foreground">
        {t("settings.seatsUsed", {
          used: sub.seatsUsed,
          max: sub.maxMembers === 0 ? "∞" : sub.maxMembers,
        })}
      </p>

      {/* Members — the managerial view (B6): role + per-member usage + actions. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="pb-2 pr-4 font-medium">{t("settings.member")}</th>
              <th className="pb-2 pr-4 font-medium">{t("settings.role")}</th>
              <th className="pb-2 pr-4 font-medium">{t("settings.usage24h")}</th>
              <th className="pb-2 pr-4 font-medium">{t("settings.usageTotalCol")}</th>
              <th className="pb-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {data.members.map((member) => (
              <tr key={member.userId} className="border-b border-border/60">
                <td className="py-2.5 pr-4">
                  <p className="truncate font-medium">{member.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                </td>
                <td className="py-2.5 pr-4">
                  {member.role === "owner" ? (
                    <span className="rounded-full bg-gold-gradient px-2 py-0.5 text-[10px] font-semibold text-gold-foreground">
                      {t("workspaceRoles.owner")}
                    </span>
                  ) : (
                    <select
                      aria-label={t("settings.role")}
                      value={member.role}
                      disabled={pending}
                      onChange={(e) =>
                        void act(() =>
                          authClient.organization.updateMemberRole({
                            memberId: member.memberId,
                            role: e.target.value as "buyer" | "viewer",
                          }),
                        )
                      }
                      className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                    >
                      <option value="buyer">{t("workspaceRoles.buyer")}</option>
                      <option value="viewer">{t("workspaceRoles.viewer")}</option>
                    </select>
                  )}
                </td>
                <td className="py-2.5 pr-4 tabular-nums text-muted-foreground">
                  {member.usedToday}
                </td>
                <td className="py-2.5 pr-4 tabular-nums text-muted-foreground">
                  {member.usedTotal}
                </td>
                <td className="py-2.5 text-right">
                  {member.role !== "owner" && (
                    <span className="inline-flex gap-2">
                      <button
                        disabled={pending}
                        onClick={() => {
                          if (window.confirm(t("settings.transferConfirm", { name: member.name })))
                            void act(() =>
                              transferOwnershipFn({ data: { toUserId: member.userId } }),
                            );
                        }}
                        className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                      >
                        {t("settings.transfer")}
                      </button>
                      <button
                        disabled={pending}
                        onClick={() => {
                          if (window.confirm(t("settings.removeConfirm", { name: member.name })))
                            void act(() =>
                              authClient.organization.removeMember({
                                memberIdOrEmail: member.memberId,
                              }),
                            );
                        }}
                        className="text-xs text-destructive underline-offset-2 hover:underline"
                      >
                        {t("settings.remove")}
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Invite (B3) / create (B4 via invitation-signup): email + role. */}
      <div>
        <p className="mb-2 text-sm font-semibold">{t("settings.inviteTitle")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            placeholder={t("settings.invitePlaceholder")}
            className="h-9 max-w-xs"
          />
          <select
            aria-label={t("settings.role")}
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as "buyer" | "viewer")}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="buyer">{t("workspaceRoles.buyer")}</option>
            <option value="viewer">{t("workspaceRoles.viewer")}</option>
          </select>
          <Button
            size="sm"
            disabled={pending || !inviteEmail.includes("@")}
            onClick={() => void invite()}
          >
            {t("settings.invite")}
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t("settings.inviteHint")}</p>
      </div>

      {data.invitations.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-semibold">{t("settings.pendingTitle")}</p>
          <ul className="divide-y divide-border/60">
            {data.invitations.map((invitation) => (
              <li key={invitation.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm">{invitation.email}</p>
                  <p className="text-xs text-muted-foreground">
                    {t(`workspaceRoles.${invitation.role}`, { defaultValue: invitation.role })}
                  </p>
                </div>
                <span className="flex shrink-0 gap-2">
                  <button
                    onClick={() => void copyLink(invitation.id)}
                    className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                  >
                    {copiedId === invitation.id ? t("settings.copied") : t("settings.copyLink")}
                  </button>
                  <button
                    disabled={pending}
                    onClick={() =>
                      void act(() =>
                        authClient.organization.cancelInvitation({
                          invitationId: invitation.id,
                        }),
                      )
                    }
                    className="text-xs text-destructive underline-offset-2 hover:underline"
                  >
                    {t("settings.revoke")}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {message && <p className="text-sm text-destructive">{message}</p>}
    </section>
  );
}

function Parametres() {
  const { t } = useTranslation();
  const router = useRouter();
  const data = Route.useLoaderData();
  const refresh = () => void router.invalidate();

  if (!data) {
    return <p className="pt-10 text-sm text-muted-foreground">{t("settings.signedOut")}</p>;
  }

  const isOwner = data.workspace.role === "owner";

  return (
    <div className="space-y-6 pt-6">
      <header>
        <h1 className="font-display text-2xl font-semibold">{t("settings.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.subtitle", { workspace: data.workspace.name })}
        </p>
      </header>

      <Tabs defaultValue="profil">
        <TabsList>
          <TabsTrigger value="profil" className={TAB_TRIGGER}>
            {t("settings.tabProfile")}
          </TabsTrigger>
          <TabsTrigger value="abonnement" className={TAB_TRIGGER}>
            {t("settings.tabSubscription")}
          </TabsTrigger>
          <TabsTrigger value="sourcing" className={TAB_TRIGGER}>
            {t("settings.tabSourcing")}
          </TabsTrigger>
          {/* Owner-only content; the tab stays visible-but-disabled for other
              roles (the app's disabled-not-hidden rule). */}
          <TabsTrigger value="utilisateurs" className={TAB_TRIGGER} disabled={!isOwner}>
            {t("settings.tabMembers")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="profil" className="mt-3">
          <ProfilPanel data={data} onSaved={refresh} />
        </TabsContent>
        <TabsContent value="abonnement" className="mt-3">
          <AbonnementPanel data={data} />
        </TabsContent>
        <TabsContent value="sourcing" className="mt-3">
          <SourcingPanel data={data} onSaved={refresh} />
        </TabsContent>
        <TabsContent value="utilisateurs" className="mt-3">
          {isOwner && <MembersPanel data={data} onSaved={refresh} />}
        </TabsContent>
      </Tabs>
    </div>
  );
}
