import { useState, type FormEvent } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";
import { getRfqInvitationFn, redeemRfqInvitationFn } from "@/lib/portal-auth-fns";

// The page an RFQ email's link leads to (Phase V · V15).
//
// PUBLIC: the token in the path is the capability, and its reader has no
// account yet (`isPublicPath`). One form takes them from the email to a
// working session — no approval step, no queue: reaching this page proves
// the mailbox the RFQ was sent to, and that is the vouching.
export const Route = createFileRoute("/portail/inscription/$token")({
  loader: async ({ params }) => getRfqInvitationFn({ data: { token: params.token } }),
  head: () => ({ meta: [{ title: "Compte fournisseur | OSI" }] }),
  component: Registration,
});

const MIN_PASSWORD = 8;

function Registration() {
  const { i18n } = useTranslation();
  const router = useRouter();
  const { token } = Route.useParams();
  const invitation = Route.useLoaderData();
  // A valid link is read in the language OSI holds for that contact — the
  // language its RFQ was written in — not in the site's default: the reader
  // has no account and no preference yet, and a supplier in Changzhou handed
  // a French form would close the tab. Same on the server and in the
  // browser, so the page hydrates as rendered.
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

  // Anything but a valid link: say which, and offer the way in for someone
  // who already has an account. No supplier name, no address — a link that
  // does not work confirms nothing.
  if (invitation.state !== "valid") {
    return (
      <section className="card-surface mx-auto w-full max-w-lg p-6">
        <h1 className="font-display text-xl font-semibold">
          {t(`portalSignup.state.${invitation.state}.title`)}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t(`portalSignup.state.${invitation.state}.text`)}
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
      const result = await redeemRfqInvitationFn({ data: { token, name, password } });
      if (!result.ok) {
        setRefusal(result.reason);
        // The link's state may have changed under the page (used in another
        // tab, expired while the form was open): show what it is now.
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
        // The account exists; only the automatic sign-in failed.
        await router.navigate({ to: "/login" });
        return;
      }
      await router.invalidate();
      await router.navigate({ to: "/portail" });
    } finally {
      setPending(false);
    }
  };

  if (attached) {
    return (
      <section className="card-surface mx-auto w-full max-w-lg p-6">
        <h1 className="font-display text-xl font-semibold">{t("portalSignup.attachedTitle")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("portalSignup.attachedText", { supplier: invitation.supplierName })}
        </p>
        <p className="mt-4 text-sm">{signInLink}</p>
      </section>
    );
  }

  if (invitation.offer === "conflict") {
    return (
      <section className="card-surface mx-auto w-full max-w-lg p-6">
        <h1 className="font-display text-xl font-semibold">{t("portalSignup.conflictTitle")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("portalSignup.conflictText", { email: invitation.email })}
        </p>
      </section>
    );
  }

  const attach = invitation.offer === "attach";
  return (
    <section className="card-surface mx-auto w-full max-w-lg p-6">
      <h1 className="font-display text-xl font-semibold">
        {attach ? t("portalSignup.attachTitle") : t("portalSignup.title")}
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        {attach
          ? t("portalSignup.attachIntro", {
              supplier: invitation.supplierName,
              email: invitation.email,
            })
          : t("portalSignup.intro", { supplier: invitation.supplierName })}
      </p>

      <form className="mt-5 space-y-4" onSubmit={(e) => void submit(e)}>
        {!attach && (
          <>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                {t("portalSignup.email")}
              </label>
              {/* Fixed: the account gets the address the RFQ was sent to —
                  that is the mailbox this link proves. */}
              <Input value={invitation.email ?? ""} readOnly disabled />
            </div>
            <div>
              <label
                htmlFor="portal-name"
                className="mb-1 block text-xs font-medium text-muted-foreground"
              >
                {t("portalSignup.name")}
              </label>
              <Input
                id="portal-name"
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
                htmlFor="portal-password"
                className="mb-1 block text-xs font-medium text-muted-foreground"
              >
                {t("portalSignup.password")}
              </label>
              <Input
                id="portal-password"
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
            {t(`portalSignup.refused.${refusal}`)}
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
