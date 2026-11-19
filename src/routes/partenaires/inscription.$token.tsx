import { useState, type FormEvent } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { getPartnerInvitationFn, redeemPartnerInvitationFn } from "@/lib/partner-auth-fns";

// The page a Partner Hub invitation leads to (Phase V · V23).
//
// PUBLIC, like the supplier's (V15): the token in the path is the capability
// and its reader has no account yet. One form takes them from the email to a
// working session. What differs is who sent the link — a staff member, to a
// person at a partner they keep on file — and where it leads: the Hub.
export const Route = createFileRoute("/partenaires/inscription/$token")({
  loader: async ({ params }) => getPartnerInvitationFn({ data: { token: params.token } }),
  head: () => ({ meta: [{ title: "Compte partenaire | OSI" }] }),
  component: Registration,
});

const MIN_PASSWORD = 8;

function Registration() {
  const { i18n } = useTranslation();
  const router = useRouter();
  const { token } = Route.useParams();
  const invitation = Route.useLoaderData();
  // Read in the language OSI holds for that partner — the language of the
  // email — not the site's default: the reader has no preference yet.
  const t = i18n.getFixedT(invitation.state === "valid" ? invitation.locale : i18n.language);
  const [name, setName] = useState(
    "contactName" in invitation ? (invitation.contactName ?? "") : "",
  );
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [attached, setAttached] = useState(false);

  const signInLink = (
    <Link to="/login" className="font-medium text-gold underline-offset-4 hover:underline">
      {t("portalSignup.signIn")}
    </Link>
  );

  // Anything but a valid link: say which. No partner name, no address — a
  // link that does not work confirms nothing.
  if (invitation.state !== "valid") {
    return (
      <section className="card-surface mx-auto w-full max-w-lg p-6">
        <h1 className="font-display text-xl font-semibold">
          {t(`partnerSignup.state.${invitation.state}.title`)}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t(`partnerSignup.state.${invitation.state}.text`)}
        </p>
        <p className="mt-4 text-sm">{signInLink}</p>
      </section>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setRefusal(null);
    try {
      const result = await redeemPartnerInvitationFn({ data: { token, name, password } });
      if (!result.ok) {
        setRefusal(result.reason);
        if (["unknown", "expired", "used", "conflict"].includes(result.reason)) {
          await router.invalidate();
        }
        return;
      }
      if (result.outcome === "attached") {
        setAttached(true);
        return;
      }
      // The session is opened by better-auth's own sign-in, with the password
      // just chosen — its cookies, its rate limit, its journal line.
      const signedIn = await authClient.signIn.email({ email: result.email, password });
      if (signedIn.error) {
        await router.navigate({ to: "/login" });
        return;
      }
      await router.invalidate();
      await router.navigate({ to: "/partenaires" });
    } finally {
      setPending(false);
    }
  };

  if (attached) {
    return (
      <section className="card-surface mx-auto w-full max-w-lg p-6">
        <h1 className="font-display text-xl font-semibold">{t("portalSignup.attachedTitle")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("partnerSignup.attachedText", { partner: invitation.partnerName })}
        </p>
        <p className="mt-4 text-sm">{signInLink}</p>
      </section>
    );
  }

  if (invitation.offer === "conflict") {
    return (
      <section className="card-surface mx-auto w-full max-w-lg p-6">
        <h1 className="font-display text-xl font-semibold">{t("partnerSignup.conflictTitle")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("partnerSignup.conflictText", { email: invitation.email })}
        </p>
      </section>
    );
  }

  const attach = invitation.offer === "attach";
  return (
    <section className="card-surface mx-auto w-full max-w-lg p-6">
      <h1 className="font-display text-xl font-semibold">
        {attach ? t("partnerSignup.attachTitle") : t("partnerSignup.title")}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {attach
          ? t("partnerSignup.attachIntro", {
              partner: invitation.partnerName,
              email: invitation.email,
            })
          : t("partnerSignup.intro", { partner: invitation.partnerName })}
      </p>

      <form className="mt-5 space-y-4" onSubmit={(e) => void submit(e)}>
        {!attach && (
          <>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                {t("portalSignup.email")}
              </label>
              {/* Fixed: the account gets the address the invitation was sent
                  to — that is the mailbox this link proves. */}
              <Input value={invitation.email ?? ""} readOnly disabled />
            </div>
            <div>
              <label
                htmlFor="partner-name"
                className="mb-1 block text-xs font-medium text-muted-foreground"
              >
                {t("portalSignup.name")}
              </label>
              <Input
                id="partner-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                required
                minLength={2}
                maxLength={120}
              />
            </div>
            <div>
              <label
                htmlFor="partner-password"
                className="mb-1 block text-xs font-medium text-muted-foreground"
              >
                {t("portalSignup.password")}
              </label>
              <Input
                id="partner-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
                minLength={MIN_PASSWORD}
                maxLength={200}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {t("portalSignup.passwordHint", { min: MIN_PASSWORD })}
              </p>
            </div>
          </>
        )}

        {refusal && (
          <p role="alert" className="text-sm text-destructive">
            {t(`partnerSignup.refused.${refusal}`)}
          </p>
        )}

        <Button type="submit" variant="gold" disabled={pending} className="w-full">
          {pending && <Loader2 className="size-4 animate-spin" />}
          {attach ? t("portalSignup.attachSubmit") : t("portalSignup.submit")}
        </Button>
        {!attach && <p className="text-xs text-muted-foreground">{t("portalSignup.free")}</p>}
      </form>
    </section>
  );
}
