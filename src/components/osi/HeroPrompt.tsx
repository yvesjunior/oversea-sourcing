// The structured request form — ADR-001 S2: form-first intake (pre-launch,
// no funnel to protect; the plain-language hero is a launch-time task).
// Category + product are required; every typed field becomes a criteria row
// directly (source "user") in createRequestFn — nothing is guessed. The
// details textarea keeps the nuance and still feeds the regex parser for
// specs (pressure, flow…). The auth gate preserves the WHOLE form as a JSON
// draft across login/signup; a legacy plain-text draft still auto-creates
// through the free-text path.

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Loader2, Mic, Paperclip, Sparkles, TriangleAlert, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import globe from "@/assets/globe.jpg";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CategoryCombobox } from "@/components/osi/CategoryCombobox";
import { createRequestFn, startRequestPipelineFn } from "@/lib/requests-fns";
import { categoryLabel, suggestCategory } from "@/lib/taxonomy";

const LEGACY_DRAFT_KEY = "osi-draft-besoin";
const DRAFT_KEY = "osi-draft-besoin-v2";

type HeroUser = { name: string } | null;

type FormFields = {
  categoryId: string;
  product: string;
  quantity: string;
  material: string;
  /** Comma-separated in the UI; split on submit. */
  certifications: string;
  leadTime: string;
  details: string;
};

const EMPTY_FIELDS: FormFields = {
  categoryId: "",
  product: "",
  quantity: "",
  material: "",
  certifications: "",
  leadTime: "",
  details: "",
};

function splitCertifications(input: string): string[] {
  return input
    .split(/[,;]+/)
    .map((c) => c.trim())
    .filter(Boolean)
    .slice(0, 12);
}

export function HeroPrompt({ user }: { user: HeroUser }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [fields, setFields] = useState<FormFields>(EMPTY_FIELDS);
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [blockedAlert, setBlockedAlert] = useState<{ title: string; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loggedIn = user !== null;
  const prenom = user?.name?.split(" ")[0];

  const set = (key: keyof FormFields) => (value: string) =>
    setFields((current) => ({ ...current, [key]: value }));

  const formValid = fields.categoryId !== "" && fields.product.trim().length >= 2;

  // Category suggestion from what the buyer typed — only while the category
  // is still unchosen; never overrides an explicit pick.
  const maybeSuggest = () => {
    if (fields.categoryId) return;
    const node = suggestCategory(`${fields.product} ${fields.material} ${fields.details}`);
    if (node) set("categoryId")(node.id);
  };

  /** The composed plain-text rendering of the answers — descriptionRaw: the
   *  research brief, the report's "need in the buyer's own words". */
  const composeDescription = (f: FormFields): string => {
    const lines = [f.product.trim()];
    lines.push(`${t("home.form.category")}: ${categoryLabel(f.categoryId, i18n.language)}`);
    if (f.material.trim()) lines.push(`${t("home.form.material")}: ${f.material.trim()}`);
    if (f.certifications.trim())
      lines.push(
        `${t("home.form.certifications")}: ${splitCertifications(f.certifications).join(", ")}`,
      );
    if (f.quantity.trim()) lines.push(`${t("home.form.quantity")}: ${f.quantity.trim()}`);
    if (f.leadTime.trim()) lines.push(`${t("home.form.leadTime")}: ${f.leadTime.trim()}`);
    if (f.details.trim()) lines.push("", f.details.trim());
    return lines.join("\n");
  };

  const handleCreateResult = (
    created: Awaited<ReturnType<typeof createRequestFn>>,
    draftToPreserve: () => void,
  ): created is Extract<Awaited<ReturnType<typeof createRequestFn>>, { ok: true }> => {
    if (created.ok) return true;
    if (created.reason === "quota_exceeded") {
      // Keep the typed need on screen: the buyer hit a wall, they did not
      // make a mistake, and retyping it tomorrow is a punishment. The two
      // walls pitch different actions: daily resets, lifetime upgrades.
      setBlockedAlert(
        created.refusal === "lifetime"
          ? {
              title: t("home.trialUsedTitle"),
              message: t("home.trialUsed", { limit: created.limit, plan: created.planName }),
            }
          : {
              title: t("home.quotaReachedTitle"),
              message: t("home.quotaReached", {
                limit: created.limit,
                plan: created.planName,
                when: created.resetAt
                  ? new Date(created.resetAt).toLocaleString(i18n.language, {
                      hour: "2-digit",
                      minute: "2-digit",
                      day: "numeric",
                      month: "long",
                    })
                  : "",
              }),
            },
      );
      return false;
    }
    if (created.reason === "forbidden") {
      // Read-only seat (viewer) — same prominent alert, different message;
      // redirecting to login would loop a perfectly authenticated user.
      setBlockedAlert({ title: t("home.readOnlyRoleTitle"), message: t("home.readOnlyRole") });
      return false;
    }
    // Session evaporated — fall back to the auth gate.
    draftToPreserve();
    void navigate({ to: "/login", search: { redirect: "/" } });
    return false;
  };

  const finishCreate = async (id: string, attachments: File[]) => {
    if (attachments.length > 0) {
      const form = new FormData();
      form.set("requestId", id);
      for (const file of attachments) form.append("files", file);
      // Best-effort: the request exists either way; failures surface on the
      // detail page where files can be re-attached.
      await fetch("/api/upload", { method: "POST", body: form }).catch(() => {});
      // Release the pipeline now the files are stored. If this call fails the
      // request still runs — the worker sweeps "received" after two minutes.
      await startRequestPipelineFn({ data: { id } }).catch(() => {});
    }
    void navigate({ to: "/demandes/$id", params: { id } });
  };

  const submitStructured = async (f: FormFields, attachments: File[]) => {
    if (submitting) return;
    setBlockedAlert(null);
    setSubmitting(true);
    try {
      const hasFiles = attachments.length > 0;
      const created = await createRequestFn({
        data: {
          description: composeDescription(f),
          structured: {
            categoryId: f.categoryId,
            product: f.product.trim(),
            ...(f.material.trim() ? { material: f.material.trim() } : {}),
            ...(f.certifications.trim()
              ? { certifications: splitCertifications(f.certifications) }
              : {}),
            ...(f.quantity.trim() ? { quantity: f.quantity.trim() } : {}),
            ...(f.leadTime.trim() ? { leadTime: f.leadTime.trim() } : {}),
            ...(f.details.trim() ? { details: f.details.trim() } : {}),
          },
          attachmentsPending: hasFiles,
        },
      });
      if (
        !handleCreateResult(created, () =>
          window.localStorage.setItem(DRAFT_KEY, JSON.stringify(f)),
        )
      )
        return;
      await finishCreate(created.id, attachments);
    } finally {
      setSubmitting(false);
    }
  };

  /** Legacy path: a plain-text draft saved before the structured form shipped
   *  still auto-creates through the free-text intake after login. */
  const submitLegacyText = async (text: string) => {
    if (!text.trim() || submitting) return;
    setBlockedAlert(null);
    setSubmitting(true);
    try {
      const created = await createRequestFn({ data: { description: text } });
      if (!handleCreateResult(created, () => window.localStorage.setItem(LEGACY_DRAFT_KEY, text)))
        return;
      await finishCreate(created.id, []);
    } finally {
      setSubmitting(false);
    }
  };

  // Restore a draft that survived the login/signup redirect (auth gate) —
  // once authenticated, the request is created automatically (no retyping).
  useEffect(() => {
    const legacy = window.localStorage.getItem(LEGACY_DRAFT_KEY);
    if (legacy) {
      setFields((current) => ({ ...current, details: legacy }));
      if (loggedIn) {
        // Remove BEFORE the async create: guards StrictMode double-effects.
        window.localStorage.removeItem(LEGACY_DRAFT_KEY);
        void submitLegacyText(legacy);
      }
      return;
    }
    const draft = window.localStorage.getItem(DRAFT_KEY);
    if (!draft) return;
    try {
      const parsed = { ...EMPTY_FIELDS, ...(JSON.parse(draft) as Partial<FormFields>) };
      setFields(parsed);
      if (loggedIn) {
        window.localStorage.removeItem(DRAFT_KEY);
        if (parsed.categoryId && parsed.product.trim().length >= 2) {
          void submitStructured(parsed, []);
        }
      }
    } catch {
      window.localStorage.removeItem(DRAFT_KEY);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedIn]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!formValid) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (!loggedIn) {
      // The auth gate: preserve the whole form, send to login, restore after.
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(fields));
      void navigate({ to: "/login", search: { redirect: "/" } });
      return;
    }
    void submitStructured(fields, files);
  };

  const onFilesPicked = (picked: FileList | null) => {
    if (!picked) return;
    setFiles((current) => [...current, ...Array.from(picked)]);
  };

  const fieldLabel = "mb-1 block text-xs font-medium text-muted-foreground";
  const requiredMark = <span className="text-gold"> *</span>;

  return (
    <section className="relative overflow-hidden pt-4">
      <img
        src={globe}
        alt={t("brand.tagline")}
        width={1200}
        height={1200}
        style={{
          maskImage: "radial-gradient(circle at 50% 50%, #000 56%, transparent 70%)",
          WebkitMaskImage: "radial-gradient(circle at 50% 50%, #000 56%, transparent 70%)",
        }}
        className="pointer-events-none absolute -right-16 -top-16 hidden w-[420px] select-none lg:block xl:-right-6 xl:w-[480px]"
      />

      <div className="relative z-10 max-w-2xl">
        {loggedIn && (
          <p className="text-lg text-muted-foreground">{t("home.greeting", { name: prenom })}</p>
        )}
        <h1 className="mt-2 font-display text-4xl font-semibold leading-tight sm:text-[42px]">
          {t("home.heroTitle")}
        </h1>

        <form className="card-surface mt-8 space-y-3 p-4" onSubmit={onSubmit}>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div>
              <label htmlFor="need-product" className={fieldLabel}>
                {t("home.form.product")}
                {requiredMark}
              </label>
              <Input
                id="need-product"
                value={fields.product}
                onChange={(e) => set("product")(e.target.value)}
                onBlur={maybeSuggest}
                placeholder={t("home.form.productPlaceholder")}
                className="h-9"
              />
            </div>
            <div>
              <label htmlFor="need-quantity" className={fieldLabel}>
                {t("home.form.quantity")}
              </label>
              <Input
                id="need-quantity"
                value={fields.quantity}
                onChange={(e) => set("quantity")(e.target.value)}
                placeholder={t("home.form.quantityPlaceholder")}
                className="h-9"
              />
            </div>
          </div>

          <div>
            <label htmlFor="need-category" className={fieldLabel}>
              {t("home.form.category")}
              {requiredMark}
            </label>
            <CategoryCombobox
              triggerId="need-category"
              value={fields.categoryId}
              onChange={set("categoryId")}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="need-material" className={fieldLabel}>
                {t("home.form.material")}
              </label>
              <Input
                id="need-material"
                value={fields.material}
                onChange={(e) => set("material")(e.target.value)}
                placeholder={t("home.form.materialPlaceholder")}
                className="h-9"
              />
            </div>
            <div>
              <label htmlFor="need-certs" className={fieldLabel}>
                {t("home.form.certifications")}
              </label>
              <Input
                id="need-certs"
                value={fields.certifications}
                onChange={(e) => set("certifications")(e.target.value)}
                placeholder={t("home.form.certificationsPlaceholder")}
                className="h-9"
              />
            </div>
            <div>
              <label htmlFor="need-lead" className={fieldLabel}>
                {t("home.form.leadTime")}
              </label>
              <Input
                id="need-lead"
                value={fields.leadTime}
                onChange={(e) => set("leadTime")(e.target.value)}
                placeholder={t("home.form.leadTimePlaceholder")}
                className="h-9"
              />
            </div>
          </div>

          <div>
            <label htmlFor="need-details" className={fieldLabel}>
              {t("home.form.details")}
            </label>
            <Textarea
              id="need-details"
              value={fields.details}
              onChange={(e) => set("details")(e.target.value)}
              onBlur={maybeSuggest}
              placeholder={t("home.form.detailsPlaceholder")}
              className="min-h-[72px] resize-none text-sm"
            />
          </div>

          {files.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {files.map((file, index) => (
                <li
                  key={`${file.name}-${index}`}
                  className="flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground"
                >
                  <Paperclip className="size-3" />
                  <span className="max-w-[180px] truncate">{file.name}</span>
                  <button
                    type="button"
                    aria-label={t("home.removeFile")}
                    onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                    className="transition-colors hover:text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {invalid && !formValid && (
            <p className="text-xs text-destructive">{t("home.form.requiredError")}</p>
          )}

          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
            <div className="flex min-w-0 items-center gap-4 text-sm text-muted-foreground">
              <button
                type="button"
                aria-label={t("home.voice")}
                className="transition-colors hover:text-foreground"
              >
                <Mic className="size-[18px]" />
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.txt,.csv"
                className="hidden"
                onChange={(e) => {
                  onFilesPicked(e.target.files);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="hidden items-center gap-2 transition-colors hover:text-foreground sm:flex"
              >
                <Paperclip className="size-4" /> {t("home.attach")}
              </button>
            </div>
            <Button type="submit" variant="gold" size="lg" disabled={submitting}>
              {submitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}{" "}
              {t("home.launch")}
            </Button>
          </div>
        </form>

        {blockedAlert && (
          <div
            role="alert"
            className="mt-3 flex items-start gap-3 rounded-lg border-2 border-warning bg-warning/10 px-4 py-3 shadow-md animate-in fade-in slide-in-from-top-2 duration-300"
          >
            <TriangleAlert className="mt-0.5 size-5 shrink-0 animate-pulse text-warning" />
            <div>
              <p className="text-sm font-semibold text-foreground">{blockedAlert.title}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">{blockedAlert.message}</p>
            </div>
          </div>
        )}
        {!loggedIn && <p className="mt-3 text-xs text-muted-foreground">{t("auth.gateHint")}</p>}
      </div>
    </section>
  );
}
