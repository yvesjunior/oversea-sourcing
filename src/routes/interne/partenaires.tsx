import { useState, type FormEvent } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { requirePlatformFeature } from "@/lib/auth-guard";
import {
  createPartnerFn,
  getPartnersFn,
  updatePartnerFn,
  type PartnerView,
} from "@/lib/partner-fns";
import { PARTNER_KINDS, partnerKindAvailable, type PartnerKind } from "@/lib/partners";
import { cn } from "@/lib/utils";

// Partners (Phase V · V21): the companies the platform works with on a
// dossier — transport, inspection, customs, insurance — kept by staff.
//
// A partner is a record here before anyone at that partner has an account;
// their people come in through the Partner Hub (V23). Every partner sits
// behind the `manual` provider today: a person does the work and what they
// answer is recorded.
export const Route = createFileRoute("/interne/partenaires")({
  beforeLoad: ({ context }) => requirePlatformFeature(context.session, "partners"),
  head: () => ({ meta: [{ title: "Partenaires | OSI" }, { name: "robots", content: "noindex" }] }),
  loader: async () => ({ partners: (await getPartnersFn()) ?? [] }),
  component: PartnersPage,
});

type Fields = {
  name: string;
  kind: PartnerKind;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  locale: "fr" | "en";
  notes: string;
  active: boolean;
};

const EMPTY: Fields = {
  name: "",
  kind: "transport",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  locale: "en",
  notes: "",
  active: true,
};

const label = "mb-1 block text-xs font-medium text-muted-foreground";
const select =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

function PartnersPage() {
  const { t } = useTranslation();
  const { partners } = Route.useLoaderData();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="space-y-6 pt-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold">{t("partnersAdmin.title")}</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            {t("partnersAdmin.subtitle")}
          </p>
        </div>
        {!adding && (
          <Button
            type="button"
            variant="gold"
            onClick={() => {
              setEditing(null);
              setAdding(true);
            }}
          >
            <Plus className="size-4" /> {t("partnersAdmin.add")}
          </Button>
        )}
      </header>

      {adding && <PartnerForm onDone={() => setAdding(false)} />}

      {partners.length === 0 && !adding ? (
        <p className="card-surface p-6 text-sm text-muted-foreground">{t("partnersAdmin.empty")}</p>
      ) : (
        <ul className="space-y-3">
          {partners.map((partner) =>
            editing === partner.id ? (
              <li key={partner.id}>
                <PartnerForm partner={partner} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <li
                key={partner.id}
                className={cn(
                  "card-surface grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 p-5",
                  !partner.active && "opacity-60",
                )}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {partner.name}
                    <span className="ml-2 rounded-full bg-gold-soft px-2 py-0.5 text-[11px] font-semibold text-gold">
                      {t(`partnersAdmin.kind.${partner.kind}`)}
                    </span>
                    {!partner.active && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {t("partnersAdmin.inactive")}
                      </span>
                    )}
                  </p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {[partner.contactName, partner.contactEmail, partner.contactPhone]
                      .filter(Boolean)
                      .join(" · ") || t("partnersAdmin.noContact")}
                  </p>
                  {partner.notes && (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {partner.notes}
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setAdding(false);
                    setEditing(partner.id);
                  }}
                >
                  {t("partnersAdmin.edit")}
                </Button>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

function PartnerForm({ partner, onDone }: { partner?: PartnerView; onDone: () => void }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [fields, setFields] = useState<Fields>(
    partner
      ? {
          name: partner.name,
          kind: partner.kind,
          contactName: partner.contactName ?? "",
          contactEmail: partner.contactEmail ?? "",
          contactPhone: partner.contactPhone ?? "",
          locale: partner.locale,
          notes: partner.notes ?? "",
          active: partner.active,
        }
      : EMPTY,
  );
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const set = <K extends keyof Fields>(key: K, value: Fields[K]) =>
    setFields((current) => ({ ...current, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setRefusal(null);
    try {
      const common = {
        name: fields.name,
        contactName: fields.contactName || null,
        contactEmail: fields.contactEmail || null,
        contactPhone: fields.contactPhone || null,
        locale: fields.locale,
        notes: fields.notes || null,
      };
      const result = partner
        ? await updatePartnerFn({ data: { id: partner.id, active: fields.active, ...common } })
        : await createPartnerFn({ data: { kind: fields.kind, ...common } });
      if (!result.ok) {
        setRefusal(result.reason);
        return;
      }
      await router.invalidate();
      onDone();
    } finally {
      setPending(false);
    }
  };

  return (
    <form className="card-surface space-y-4 p-5" onSubmit={(e) => void submit(e)}>
      <h2 className="text-sm font-semibold">
        {partner
          ? t("partnersAdmin.editTitle", { name: partner.name })
          : t("partnersAdmin.addTitle")}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="partner-name" className={label}>
            {t("partnersAdmin.field.name")} *
          </label>
          <Input
            id="partner-name"
            value={fields.name}
            onChange={(e) => set("name", e.target.value)}
            required
            minLength={2}
            maxLength={120}
          />
        </div>
        <div>
          <label htmlFor="partner-kind" className={label}>
            {t("partnersAdmin.field.kind")} *
          </label>
          {/* The kind is the slot a case is opened with: chosen once. */}
          <select
            id="partner-kind"
            className={select}
            value={fields.kind}
            disabled={!!partner}
            onChange={(e) => set("kind", e.target.value as PartnerKind)}
          >
            {PARTNER_KINDS.map((kind) => (
              <option key={kind} value={kind} disabled={!partnerKindAvailable(kind)}>
                {t(`partnersAdmin.kind.${kind}`)}
                {!partnerKindAvailable(kind) ? ` — ${t("partnersAdmin.kindUnavailable")}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="partner-contact" className={label}>
            {t("partnersAdmin.field.contactName")}
          </label>
          <Input
            id="partner-contact"
            value={fields.contactName}
            onChange={(e) => set("contactName", e.target.value)}
            maxLength={120}
          />
        </div>
        <div>
          <label htmlFor="partner-email" className={label}>
            {t("partnersAdmin.field.contactEmail")}
          </label>
          <Input
            id="partner-email"
            type="email"
            value={fields.contactEmail}
            onChange={(e) => set("contactEmail", e.target.value)}
            maxLength={200}
          />
        </div>
        <div>
          <label htmlFor="partner-phone" className={label}>
            {t("partnersAdmin.field.contactPhone")}
          </label>
          <Input
            id="partner-phone"
            value={fields.contactPhone}
            onChange={(e) => set("contactPhone", e.target.value)}
            maxLength={40}
          />
        </div>
        <div>
          <label htmlFor="partner-locale" className={label}>
            {t("partnersAdmin.field.locale")}
          </label>
          <select
            id="partner-locale"
            className={select}
            value={fields.locale}
            onChange={(e) => set("locale", e.target.value as "fr" | "en")}
          >
            <option value="en">English</option>
            <option value="fr">Français</option>
          </select>
        </div>
      </div>
      <div>
        <label htmlFor="partner-notes" className={label}>
          {t("partnersAdmin.field.notes")}
        </label>
        <Textarea
          id="partner-notes"
          value={fields.notes}
          onChange={(e) => set("notes", e.target.value)}
          maxLength={1000}
          rows={2}
        />
      </div>
      {partner && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={fields.active}
            onChange={(e) => set("active", e.target.checked)}
          />
          {t("partnersAdmin.field.active")}
        </label>
      )}
      {refusal && (
        <p role="alert" className="text-sm text-destructive">
          {t(`partnersAdmin.refused.${refusal}`)}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button type="submit" variant="gold" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          {partner ? t("partnersAdmin.save") : t("partnersAdmin.create")}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("partnersAdmin.cancel")}
        </Button>
      </div>
    </form>
  );
}
