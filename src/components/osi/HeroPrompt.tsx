import { Mic, Paperclip, Sparkles, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import globe from "@/assets/globe.jpg";
import { utilisateur } from "@/data/osi";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function HeroPrompt() {
  const { t } = useTranslation();

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
        <p className="text-lg text-muted-foreground">
          {t("home.greeting", { name: utilisateur.prenom })}
        </p>
        <h1 className="mt-2 font-display text-4xl font-semibold leading-tight sm:text-[42px]">
          {t("home.heroTitle")}
        </h1>

        <form className="card-surface mt-8 p-4" onSubmit={(event) => event.preventDefault()}>
          <Textarea
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
      </div>
    </section>
  );
}
