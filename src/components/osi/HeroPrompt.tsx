import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Info, Loader2, Mic, Paperclip, Sparkles, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import globe from "@/assets/globe.jpg";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { createRequestFn } from "@/lib/requests-fns";

const HELP_HINT_KEYS = [
  "product",
  "material",
  "specs",
  "certifications",
  "quantity",
  "leadTime",
] as const;

const DRAFT_KEY = "osi-draft-besoin";

type HeroUser = { name: string } | null;

export function HeroPrompt({ user }: { user: HeroUser }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [besoin, setBesoin] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loggedIn = user !== null;
  const prenom = user?.name?.split(" ")[0];

  const submitNeed = async (text: string, attachments: File[]) => {
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    try {
      const created = await createRequestFn({ data: { description: text } });
      if (!created) {
        // Session evaporated — fall back to the auth gate.
        window.localStorage.setItem(DRAFT_KEY, text);
        void navigate({ to: "/login", search: { redirect: "/" } });
        return;
      }
      if (attachments.length > 0) {
        const form = new FormData();
        form.set("requestId", created.id);
        for (const file of attachments) form.append("files", file);
        // Best-effort: the request exists either way; failures surface on the
        // detail page where files can be re-attached.
        await fetch("/api/upload", { method: "POST", body: form }).catch(() => {});
      }
      void navigate({ to: "/demandes/$id", params: { id: created.id } });
    } finally {
      setSubmitting(false);
    }
  };

  // Restore a draft that survived the login/signup redirect (auth gate) —
  // once authenticated, the request is created automatically (no retyping).
  useEffect(() => {
    const draft = window.localStorage.getItem(DRAFT_KEY);
    if (!draft) return;
    setBesoin(draft);
    if (loggedIn) {
      // Remove BEFORE the async create: guards StrictMode double-effects.
      window.localStorage.removeItem(DRAFT_KEY);
      void submitNeed(draft, []);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loggedIn]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!loggedIn) {
      // The auth gate: preserve the typed need, send to login, restore after.
      if (besoin.trim()) window.localStorage.setItem(DRAFT_KEY, besoin);
      void navigate({ to: "/login", search: { redirect: "/" } });
      return;
    }
    void submitNeed(besoin, files);
  };

  const onFilesPicked = (picked: FileList | null) => {
    if (!picked) return;
    setFiles((current) => [...current, ...Array.from(picked)]);
  };

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

        <form className="card-surface mt-8 p-4" onSubmit={onSubmit}>
          <div className="flex items-start gap-2">
            <Textarea
              value={besoin}
              onChange={(e) => setBesoin(e.target.value)}
              placeholder={t("home.placeholder")}
              className="min-h-[92px] flex-1 resize-none border-0 bg-transparent px-2 text-base shadow-none focus-visible:ring-0"
            />
            {/* The input guide replaces the removed pre-search AI analysis:
                buyers structure the need themselves; intake parsing does the rest. */}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label={t("home.helpAria")}
                  className="mt-1 shrink-0 text-muted-foreground transition-colors hover:text-gold"
                >
                  <Info className="size-[18px]" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 text-sm">
                <p className="font-semibold">{t("home.helpTitle")}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t("home.helpIntro")}</p>
                <ul className="mt-3 space-y-1.5 text-xs text-muted-foreground">
                  {HELP_HINT_KEYS.map((key) => (
                    <li key={key} className="flex gap-2">
                      <span className="mt-1.5 size-1 shrink-0 rounded-full bg-gold" />
                      <span>{t(`home.helpHints.${key}`)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 rounded-lg bg-secondary p-3 text-xs italic leading-relaxed text-muted-foreground">
                  {t("home.helpExample")}
                </p>
              </PopoverContent>
            </Popover>
          </div>
          {files.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-2 px-2">
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
          <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
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

        {!loggedIn && <p className="mt-3 text-xs text-muted-foreground">{t("auth.gateHint")}</p>}
      </div>
    </section>
  );
}
