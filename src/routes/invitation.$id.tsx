// Invitation landing page (B3, 2026-08-23) — the link in the invitation email.
// Public route: anonymous visitors are sent to login/signup and come back;
// the signed-in invitee accepts or declines through the org plugin (seat cap
// and role rules enforced server-side in auth.ts organizationHooks).

import { useState } from "react";
import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { getInvitationFn, type InvitationView } from "@/lib/team-fns";

export const Route = createFileRoute("/invitation/$id")({
  head: () => ({ meta: [{ title: "Invitation | OSI" }] }),
  loader: async ({ params }): Promise<InvitationView> =>
    await getInvitationFn({ data: { id: params.id } }),
  component: InvitationPage,
});

function InvitationPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const invitation = Route.useLoaderData();
  const { id } = Route.useParams();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!invitation) {
    return <Card title={t("invitation.notFoundTitle")} body={t("invitation.notFound")} />;
  }
  if (invitation.status !== "pending" || invitation.expired) {
    return <Card title={t("invitation.goneTitle")} body={t("invitation.gone")} />;
  }

  const accept = async () => {
    setPending(true);
    setError(null);
    try {
      const result = await authClient.organization.acceptInvitation({ invitationId: id });
      if (result.error) {
        setError(
          result.error.message === "SEAT_LIMIT_REACHED"
            ? t("invitation.seatLimit")
            : t("invitation.error"),
        );
        return;
      }
      const orgId = result.data?.invitation.organizationId;
      if (orgId) await authClient.organization.setActive({ organizationId: orgId });
      await router.navigate({ to: "/" });
      await router.invalidate();
    } finally {
      setPending(false);
    }
  };

  const decline = async () => {
    setPending(true);
    try {
      await authClient.organization.rejectInvitation({ invitationId: id });
      await router.navigate({ to: "/" });
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mx-auto max-w-md pt-16">
      <div className="card-surface space-y-5 p-8 text-center">
        <Building2 className="mx-auto size-10 text-gold" />
        <div>
          <h1 className="font-display text-xl font-semibold">
            {t("invitation.title", { workspace: invitation.workspaceName })}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("invitation.body", {
              inviter: invitation.inviterName,
              role: t(`workspaceRoles.${invitation.role}`, { defaultValue: invitation.role }),
            })}
          </p>
        </div>

        {invitation.caller === "anonymous" && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t("invitation.signInFirst")}</p>
            <div className="flex justify-center gap-3">
              <Link
                to="/login"
                search={{ redirect: `/invitation/${id}` }}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
              >
                {t("auth.submitSignin")}
              </Link>
              <Link
                to="/signup"
                search={{ redirect: `/invitation/${id}` }}
                className="rounded-lg border border-border px-4 py-2 text-sm font-semibold"
              >
                {t("auth.signupLink")}
              </Link>
            </div>
          </div>
        )}

        {invitation.caller === "mismatch" && (
          <p className="text-sm text-muted-foreground">
            {t("invitation.wrongAccount", { email: invitation.email })}
          </p>
        )}

        {invitation.caller === "match" && (
          <div className="flex justify-center gap-3">
            <Button variant="gold" disabled={pending} onClick={() => void accept()}>
              {t("invitation.accept")}
            </Button>
            <Button variant="outline" disabled={pending} onClick={() => void decline()}>
              {t("invitation.decline")}
            </Button>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </div>
  );
}

function Card({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto max-w-md pt-16">
      <div className="card-surface space-y-3 p-8 text-center">
        <h1 className="font-display text-xl font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}
