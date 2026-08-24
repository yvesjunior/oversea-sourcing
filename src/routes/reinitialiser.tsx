// Password reset landing page (E1, 2026-08-23). Public. better-auth redirects
// the email link here with ?token=… (valid) or ?error=INVALID_TOKEN.

import { useState, type FormEvent } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/reinitialiser")({
  validateSearch: z.object({
    token: z.string().optional(),
    error: z.string().optional(),
  }),
  head: () => ({ meta: [{ title: "Nouveau mot de passe | OSI" }] }),
  component: ResetPassword,
});

function ResetPassword() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { token, error: linkError } = Route.useSearch();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const invalidLink = !token || linkError;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < 8) {
      setError(t("auth.passwordHint"));
      return;
    }
    if (password !== confirm) {
      setError(t("resetPwd.mismatch"));
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await authClient.resetPassword({ newPassword: password, token: token! });
      if (result.error) {
        setError(t("resetPwd.failed"));
        return;
      }
      void navigate({ to: "/login", search: { redirect: "/" } });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mx-auto max-w-md pt-16">
      <div className="card-surface space-y-5 p-8">
        <div className="text-center">
          <h1 className="font-display text-xl font-semibold">{t("resetPwd.title")}</h1>
        </div>

        {invalidLink ? (
          <div className="space-y-4 text-center">
            <p className="rounded-lg bg-secondary p-4 text-sm">{t("resetPwd.invalidLink")}</p>
            <Link to="/mot-de-passe-oublie" className="text-sm text-gold hover:underline">
              {t("resetPwd.requestAgain")}
            </Link>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={(e) => void submit(e)}>
            <div className="grid gap-1.5">
              <Label htmlFor="new-password">{t("resetPwd.newPassword")}</Label>
              <Input
                id="new-password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">{t("auth.passwordHint")}</p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="confirm-password">{t("resetPwd.confirmPassword")}</Label>
              <Input
                id="confirm-password"
                type="password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" variant="gold" className="w-full" disabled={pending}>
              {t("resetPwd.submit")}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
