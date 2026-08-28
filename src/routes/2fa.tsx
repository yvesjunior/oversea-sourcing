// 2FA login step (E1, 2026-08-27) — where a password sign-in lands when the
// account has 2FA on (twoFactorClient's onTwoFactorRedirect). Public + bare:
// the visitor is half-authenticated (better-auth's 2FA cookie), not signed
// in. TOTP first, backup code as the fallback link.

import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

export const Route = createFileRoute("/2fa")({
  head: () => ({ meta: [{ title: "2FA | OSI" }] }),
  component: TwoFactorPage,
});

function TwoFactorPage() {
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const [useBackup, setUseBackup] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const verify = async () => {
    setPending(true);
    setFailed(false);
    try {
      const result = useBackup
        ? await authClient.twoFactor.verifyBackupCode({ code: code.trim() })
        : await authClient.twoFactor.verifyTotp({ code: code.trim() });
      if (result.error) {
        setFailed(true);
        return;
      }
      // Full page load: the session just went from half- to fully
      // authenticated — restart the shell from scratch.
      window.location.href = "/";
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="w-full max-w-sm">
      <div className="card-surface space-y-5 p-8 text-center">
        <ShieldCheck className="mx-auto size-10 text-gold" />
        <div>
          <h1 className="font-display text-xl font-semibold">{t("twofa.title")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t(useBackup ? "twofa.bodyBackup" : "twofa.body")}
          </p>
        </div>
        <div className="grid gap-1.5 text-left">
          <Label htmlFor="twofa-code">
            {t(useBackup ? "twofa.backupLabel" : "twofa.codeLabel")}
          </Label>
          <Input
            id="twofa-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && code.trim()) void verify();
            }}
            autoComplete="one-time-code"
            inputMode={useBackup ? "text" : "numeric"}
            placeholder={useBackup ? "xxxxx-xxxxx" : "123456"}
            autoFocus
          />
        </div>
        <Button className="w-full" disabled={pending || !code.trim()} onClick={() => void verify()}>
          {t("twofa.submit")}
        </Button>
        {failed && <p className="text-sm text-destructive">{t("twofa.failed")}</p>}
        <button
          type="button"
          onClick={() => {
            setUseBackup((v) => !v);
            setCode("");
            setFailed(false);
          }}
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          {t(useBackup ? "twofa.useTotp" : "twofa.useBackup")}
        </button>
      </div>
    </div>
  );
}
