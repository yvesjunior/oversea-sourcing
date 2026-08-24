// Forgot-password request page (E1, 2026-08-23). Public. The answer is the
// SAME whether the account exists or not — a form that says "no such account"
// is an email-enumeration oracle. Rate limited server-side (3/h per IP).

import { useState, type FormEvent } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/mot-de-passe-oublie")({
  head: () => ({ meta: [{ title: "Mot de passe oublié | OSI" }] }),
  component: ForgotPassword,
});

function ForgotPassword() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    try {
      await authClient.requestPasswordReset({
        email: email.trim(),
        redirectTo: "/reinitialiser",
      });
    } finally {
      // Always "sent": existence of the account is none of the form's business.
      setSent(true);
      setPending(false);
    }
  };

  return (
    <div className="mx-auto max-w-md pt-16">
      <div className="card-surface space-y-5 p-8">
        <div className="text-center">
          <h1 className="font-display text-xl font-semibold">{t("resetPwd.forgotTitle")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("resetPwd.forgotSubtitle")}</p>
        </div>

        {sent ? (
          <p className="rounded-lg bg-secondary p-4 text-center text-sm">
            {t("resetPwd.sent", { email: email.trim() })}
          </p>
        ) : (
          <form className="space-y-4" onSubmit={(e) => void submit(e)}>
            <div className="grid gap-1.5">
              <Label htmlFor="forgot-email">{t("auth.email")}</Label>
              <Input
                id="forgot-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t("settings.invitePlaceholder")}
              />
            </div>
            <Button type="submit" variant="gold" className="w-full" disabled={pending}>
              {t("resetPwd.send")}
            </Button>
          </form>
        )}

        <p className="text-center text-sm text-muted-foreground">
          <Link to="/login" className="text-gold hover:underline">
            {t("resetPwd.backToLogin")}
          </Link>
        </p>
      </div>
    </div>
  );
}
