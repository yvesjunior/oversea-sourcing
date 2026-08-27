// Paramètres (B5, 2026-08-23) — one route, four panels:
//   Profil        every member — name + language, server-persisted
//   Abonnement    every member — the workspace's plan, limits and live usage
//                 (read-only mirror of what /interne/plans grants; upgrade CTA
//                 is "Contactez-nous" until billing lands)
//   Sourcing      owner edits, others read — activated sources + country origin
//   Utilisateurs  owner only — the member list (invite/create arrive with B3)

import { useEffect, useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { STORAGE_KEY } from "@/i18n/config";
import { authClient } from "@/lib/auth-client";
import { getNotificationPrefsFn, updateNotificationPrefsFn } from "@/lib/notification-fns";
import {
  channelEnabled,
  NOTIFICATION_TYPES,
  type NotificationPrefs,
} from "@/lib/notification-types";
import { transferOwnershipFn } from "@/lib/team-fns";
import {
  destroyWorkspaceFn,
  getOrganizationProfileFn,
  getSettingsFn,
  updateOrganizationProfileFn,
  updateProfileFn,
  updateSourcingRulesFn,
  type OrganizationProfileData,
  type SettingsData,
} from "@/lib/settings-fns";

export const Route = createFileRoute("/parametres")({
  head: () => ({ meta: [{ title: "Paramètres | OSI" }] }),
  loader: async (): Promise<SettingsData> => await getSettingsFn(),
  component: Parametres,
});

const TAB_TRIGGER =
  "py-1 data-[state=active]:bg-gold-gradient data-[state=active]:text-gold-foreground data-[state=active]:shadow-gold";

/** Account destruction (workspace-owner capability, 2026-08-26): deletes
 *  the workspace and everything in it; members whose only workspace this
 *  was lose their accounts — org-signup owners included. Guarded by typing
 *  the exact workspace name. Shown to the owner only. */
function DangerZone({ workspaceName, type }: { workspaceName: string; type: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [confirmName, setConfirmName] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const destroy = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const result = await destroyWorkspaceFn({ data: { confirmName } });
      if (!result.ok) {
        setFailed(true);
        return;
      }
      // Whether the caller's account went with the workspace or they fell
      // back to another one, the session state is stale — restart from "/".
      window.location.href = "/";
    } finally {
      setBusy(false);
      void router; // (router retained for future soft-navigation)
    }
  };

  return (
    <section className="max-w-xl rounded-xl border-2 border-destructive/40 p-6">
      <p className="text-sm font-semibold text-destructive">{t("settings.dangerTitle")}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {t(type === "individual" ? "settings.dangerHintIndividual" : "settings.dangerHintOrg")}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Input
          value={confirmName}
          onChange={(e) => setConfirmName(e.target.value)}
          placeholder={t("settings.dangerConfirm", { name: workspaceName })}
          className="h-9 max-w-xs text-sm"
        />
        <Button
          size="sm"
          variant="destructive"
          disabled={busy || confirmName.trim() !== workspaceName}
          onClick={() => void destroy()}
        >
          {t("settings.dangerButton")}
        </Button>
      </div>
      {failed && <p className="mt-2 text-xs text-destructive">{t("settings.dangerFailed")}</p>}
    </section>
  );
}

/** Organisation profile (owner, 2026-08-26) — the company's legal & tax
 *  identity, on non-individual workspaces only. The workspace owner edits;
 *  every other member sees the same fields read-only (visible, not hidden —
 *  the app's rule). */
function OrganizationPanel({ isOwner }: { isOwner: boolean }) {
  const { t } = useTranslation();
  const [profile, setProfile] = useState<OrganizationProfileData | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void getOrganizationProfileFn().then(setProfile);
  }, []);

  if (!profile) return <p className="text-sm text-muted-foreground">…</p>;

  const set = (key: keyof OrganizationProfileData) => (value: string) => {
    setSaved(false);
    setProfile((current) => (current ? { ...current, [key]: value } : current));
  };

  const save = async () => {
    setSaving(true);
    try {
      const result = await updateOrganizationProfileFn({ data: profile });
      setSaved(result.ok);
    } finally {
      setSaving(false);
    }
  };

  const field = (key: keyof OrganizationProfileData, autoComplete?: string) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`org-${key}`}>{t(`settings.orgFields.${key}`)}</Label>
      <Input
        id={`org-${key}`}
        value={profile[key]}
        onChange={(e) => set(key)(e.target.value)}
        disabled={!isOwner}
        {...(autoComplete ? { autoComplete } : {})}
        className={isOwner ? "" : "text-muted-foreground"}
      />
    </div>
  );

  return (
    <section className="card-surface max-w-xl space-y-5 p-6">
      {!isOwner && <p className="text-xs text-muted-foreground">{t("settings.ownerOnly")}</p>}
      <div>
        <p className="mb-3 text-sm font-semibold">{t("settings.orgInfoTitle")}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {field("legalName", "organization")}
          {field("website", "url")}
          {field("phone", "tel")}
          {field("countryCode", "country")}
          {field("addressLine", "street-address")}
          {field("city", "address-level2")}
          {field("postalCode", "postal-code")}
        </div>
      </div>
      <div>
        <p className="mb-3 text-sm font-semibold">{t("settings.orgTaxTitle")}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {field("registrationNumber")}
          {field("taxId")}
        </div>
      </div>
      {isOwner && (
        <div className="flex items-center gap-3">
          <Button size="sm" disabled={saving} onClick={() => void save()}>
            {t("settings.save")}
          </Button>
          {saved && <span className="text-xs text-emerald-600">{t("settings.savedShort")}</span>}
        </div>
      )}
    </section>
  );
}

/** E9/E11 — per-user notification preferences: one row per registry type,
 *  a switch per channel (email only where the type sends one). Missing = ON;
 *  the whole map is saved as one row. Loads on mount: the prefs are personal
 *  and not part of the workspace-scoped SettingsData payload. */
function NotificationsPanel() {
  const { t } = useTranslation();
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void getNotificationPrefsFn().then(setPrefs);
  }, []);

  const toggle = (type: string, channel: "inApp" | "email", enabled: boolean) => {
    setSaved(false);
    setPrefs((current) => ({
      ...(current ?? {}),
      [type]: { ...(current?.[type] ?? {}), [channel]: enabled },
    }));
  };

  const save = async () => {
    if (!prefs) return;
    setSaving(true);
    try {
      const result = await updateNotificationPrefsFn({ data: { prefs } });
      setSaved(result.ok);
    } finally {
      setSaving(false);
    }
  };

  if (!prefs) return <p className="text-sm text-muted-foreground">…</p>;

  return (
    <section className="card-surface max-w-xl space-y-5 p-6">
      <div>
        <p className="mb-1 text-sm font-semibold">{t("settings.notifTitle")}</p>
        <p className="mb-4 text-xs text-muted-foreground">{t("settings.notifHint")}</p>
        <div className="space-y-3">
          {NOTIFICATION_TYPES.map((entry) => (
            <div
              key={entry.type}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-secondary/50 px-3 py-2.5"
            >
              <p className="text-sm">{t(`settings.notifTypes.${entry.type}`)}</p>
              <span className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  {t("settings.notifInApp")}
                  <Switch
                    checked={channelEnabled(prefs, entry.type, "inApp")}
                    aria-label={`${t(`settings.notifTypes.${entry.type}`)} — ${t("settings.notifInApp")}`}
                    onCheckedChange={(checked) => toggle(entry.type, "inApp", checked)}
                  />
                </label>
                {entry.hasEmail && (
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    {t("settings.notifEmail")}
                    <Switch
                      checked={channelEnabled(prefs, entry.type, "email")}
                      aria-label={`${t(`settings.notifTypes.${entry.type}`)} — ${t("settings.notifEmail")}`}
                      onCheckedChange={(checked) => toggle(entry.type, "email", checked)}
                    />
                  </label>
                )}
              </span>
            </div>
          ))}
        </div>
        {/* Transactional mail (verification, reset, invitations) is never
            silenceable — say so, or a muted user thinks reset emails broke. */}
        <p className="mt-3 text-xs text-muted-foreground">{t("settings.notifTransactional")}</p>
      </div>
      <div className="flex items-center gap-3">
        <Button size="sm" disabled={saving} onClick={() => void save()}>
          {t("settings.save")}
        </Button>
        {saved && <span className="text-xs text-emerald-600">{t("settings.savedShort")}</span>}
      </div>
    </section>
  );
}

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
        {/* ADR-001: registries are verification infrastructure — deliberately
            absent from this list; buyers meet them as evidence on profiles. */}
        <p className="mt-3 text-xs text-muted-foreground">
          {t("settings.sourcesVerificationNote")}
        </p>
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
          {data.workspace.type !== "individual" && (
            <TabsTrigger value="organisation" className={TAB_TRIGGER}>
              {t("settings.tabOrganisation")}
            </TabsTrigger>
          )}
          <TabsTrigger value="abonnement" className={TAB_TRIGGER}>
            {t("settings.tabSubscription")}
          </TabsTrigger>
          <TabsTrigger value="sourcing" className={TAB_TRIGGER}>
            {t("settings.tabSourcing")}
          </TabsTrigger>
          <TabsTrigger value="notifications" className={TAB_TRIGGER}>
            {t("settings.tabNotifications")}
          </TabsTrigger>
          {/* Owner-only content; the tab stays visible-but-disabled for other
              roles (the app's disabled-not-hidden rule). */}
          <TabsTrigger value="utilisateurs" className={TAB_TRIGGER} disabled={!isOwner}>
            {t("settings.tabMembers")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="profil" className="mt-3 space-y-4">
          <ProfilPanel data={data} onSaved={refresh} />
          {data.workspace.type === "individual" && isOwner && (
            <DangerZone workspaceName={data.workspace.name} type={data.workspace.type} />
          )}
        </TabsContent>
        {data.workspace.type !== "individual" && (
          <TabsContent value="organisation" className="mt-3 space-y-4">
            <OrganizationPanel isOwner={isOwner} />
            {/* Never offered on the internal OSI workspace (server refuses
                it too) — owner decision 2026-08-26. */}
            {isOwner && data.workspace.type === "enterprise" && (
              <DangerZone workspaceName={data.workspace.name} type={data.workspace.type} />
            )}
          </TabsContent>
        )}
        <TabsContent value="abonnement" className="mt-3">
          <AbonnementPanel data={data} />
        </TabsContent>
        <TabsContent value="sourcing" className="mt-3">
          <SourcingPanel data={data} onSaved={refresh} />
        </TabsContent>
        <TabsContent value="notifications" className="mt-3">
          <NotificationsPanel />
        </TabsContent>
        <TabsContent value="utilisateurs" className="mt-3">
          {isOwner && <MembersPanel data={data} onSaved={refresh} />}
        </TabsContent>
      </Tabs>
    </div>
  );
}
