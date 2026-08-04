import { useState, type FormEvent } from "react";
import { Link, useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-4">
      <path
        fill="#4285F4"
        d="M23.5 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.46a5.53 5.53 0 0 1-2.4 3.63v3h3.87c2.27-2.09 3.57-5.17 3.57-8.82Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.87-3c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.28v3.09A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.28a7.2 7.2 0 0 1 0-4.56V6.63H1.28a12 12 0 0 0 0 10.74l3.99-3.09Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.43-3.43A11.97 11.97 0 0 0 1.28 6.63l3.99 3.09C6.22 6.87 8.87 4.75 12 4.75Z"
      />
    </svg>
  );
}

/** Only allow internal targets — never redirect off-site after auth. */
function safeRedirect(target: string | undefined): string {
  return target && target.startsWith("/") && !target.startsWith("//") ? target : "/";
}

export function AuthForm({
  mode,
  googleEnabled,
  redirect,
}: {
  mode: "signin" | "signup";
  googleEnabled: boolean;
  redirect?: string | undefined;
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const target = safeRedirect(redirect);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result =
        mode === "signin"
          ? await authClient.signIn.email({ email, password })
          : await authClient.signUp.email({
              email,
              password,
              name,
              locale: i18n.language,
            });
      if (result.error) {
        const code = result.error.code ?? "";
        setError(
          code.includes("ALREADY_EXISTS")
            ? t("auth.errorExists")
            : code.includes("INVALID") || result.error.status === 401
              ? t("auth.errorInvalid")
              : t("auth.errorGeneric"),
        );
        return;
      }
      await router.invalidate();
      await router.navigate({ to: target });
    } catch {
      setError(t("auth.errorGeneric"));
    } finally {
      setPending(false);
    }
  };

  const onGoogle = () => {
    void authClient.signIn.social({ provider: "google", callbackURL: target });
  };

  // Dev-only connection facilitator: one-click sign-in as any seeded demo
  // account. `import.meta.env.DEV` is compiled out of production builds.
  const quickLogin = async (demoEmail: string) => {
    setError(null);
    setPending(true);
    try {
      const result = await authClient.signIn.email({
        email: demoEmail,
        password: "osi-demo-1234",
      });
      if (result.error) {
        setError(t("auth.errorGeneric"));
        return;
      }
      await router.invalidate();
      await router.navigate({ to: target });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="card-surface w-full max-w-md p-8">
      <div className="text-center">
        <span className="font-display text-3xl font-extrabold tracking-tight text-gradient-gold">
          OSI
        </span>
        <h1 className="mt-4 font-display text-xl font-semibold">
          {t(mode === "signin" ? "auth.signinTitle" : "auth.signupTitle")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(mode === "signin" ? "auth.signinSubtitle" : "auth.signupSubtitle")}
        </p>
      </div>

      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        {mode === "signup" && (
          <div className="space-y-1.5">
            <Label htmlFor="name">{t("auth.name")}</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("auth.namePlaceholder")}
              autoComplete="name"
              required
            />
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="email">{t("auth.email")}</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="henrik@entreprise.com"
            autoComplete="email"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">{t("auth.password")}</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            minLength={8}
            required
          />
          {mode === "signup" && (
            <p className="text-xs text-muted-foreground">{t("auth.passwordHint")}</p>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button type="submit" variant="gold" size="lg" className="w-full" disabled={pending}>
          {pending
            ? t("auth.loading")
            : t(mode === "signin" ? "auth.submitSignin" : "auth.submitSignup")}
        </Button>
      </form>

      {googleEnabled && (
        <>
          <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            {t("auth.or")}
            <span className="h-px flex-1 bg-border" />
          </div>
          <Button type="button" variant="outline" size="lg" className="w-full" onClick={onGoogle}>
            <GoogleIcon /> {t("auth.google")}
          </Button>
        </>
      )}

      {import.meta.env.DEV && mode === "signin" && (
        <div className="mt-6 rounded-xl border border-dashed border-border p-4">
          <p className="text-center text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Connexion rapide — dev
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {["buyer", "manager", "accountant", "owner"].map((compte) => (
              <Button
                key={compte}
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => void quickLogin(`${compte}@osi.dev`)}
                className="capitalize"
              >
                {compte}
              </Button>
            ))}
          </div>
        </div>
      )}

      <p className="mt-6 text-center text-sm text-muted-foreground">
        {t(mode === "signin" ? "auth.noAccount" : "auth.haveAccount")}{" "}
        {mode === "signin" ? (
          <Link
            to="/signup"
            search={{ redirect }}
            className="font-semibold text-gold hover:underline"
          >
            {t("auth.signupLink")}
          </Link>
        ) : (
          <Link
            to="/login"
            search={{ redirect }}
            className="font-semibold text-gold hover:underline"
          >
            {t("auth.signinLink")}
          </Link>
        )}
      </p>
    </div>
  );
}
