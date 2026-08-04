import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Mic, Paperclip, Sparkles, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import globe from "@/assets/globe.jpg";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const DRAFT_KEY = "osi-draft-besoin";

type HeroUser = { name: string } | null;

export function HeroPrompt({ user }: { user: HeroUser }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [besoin, setBesoin] = useState("");
  const loggedIn = user !== null;
  const prenom = user?.name?.split(" ")[0];

  // Restore a draft that survived the login/signup redirect (auth gate).
  useEffect(() => {
    const draft = window.localStorage.getItem(DRAFT_KEY);
    if (draft) {
      setBesoin(draft);
      if (loggedIn) window.localStorage.removeItem(DRAFT_KEY);
    }
  }, [loggedIn]);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!loggedIn) {
      // The auth gate: preserve the typed need, send to login, restore after.
      if (besoin.trim()) window.localStorage.setItem(DRAFT_KEY, besoin);
      void navigate({ to: "/login", search: { redirect: "/" } });
      return;
    }
    // Logged in: request creation ships with E3 (AI criteria extraction).
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
          <Textarea
            value={besoin}
            onChange={(e) => setBesoin(e.target.value)}
            placeholder={t("home.placeholder")}
            className="min-h-[92px] resize-none border-0 bg-transparent px-2 text-base shadow-none focus-visible:ring-0"
          />
          <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
            <div className="flex min-w-0 items-center gap-4 text-sm text-muted-foreground">
              <button
                type="button"
                aria-label={t("home.voice")}
                className="transition-colors hover:text-foreground"
              >
                <Mic className="size-[18px]" />
              </button>
              <button
                type="button"
                className="hidden items-center gap-2 transition-colors hover:text-foreground sm:flex"
              >
                <Paperclip className="size-4" /> {t("home.attach")}
              </button>
              <button
                type="button"
                className="hidden items-center gap-2 transition-colors hover:text-foreground lg:flex"
              >
                <Wrench className="size-4" /> {t("home.addPlan")}
              </button>
            </div>
            <Button type="submit" variant="gold" size="lg">
              <Sparkles className="size-4" /> {t("home.launch")}
            </Button>
          </div>
        </form>

        {!loggedIn && <p className="mt-3 text-xs text-muted-foreground">{t("auth.gateHint")}</p>}
      </div>
    </section>
  );
}
