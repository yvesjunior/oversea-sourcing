import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { AuthForm } from "@/components/osi/AuthForm";
import { getAuthConfigFn } from "@/lib/session-fns";

const searchSchema = z.object({
  redirect: z.string().optional(),
});

export const Route = createFileRoute("/signup")({
  validateSearch: searchSchema,
  beforeLoad: ({ context, search }) => {
    if (context.session) {
      throw redirect({ to: search.redirect ?? "/" });
    }
  },
  loader: () => getAuthConfigFn(),
  head: () => ({
    meta: [{ title: "Créer un compte | OSI" }, { name: "robots", content: "noindex" }],
  }),
  component: SignupPage,
});

function SignupPage() {
  const { googleEnabled } = Route.useLoaderData();
  const { redirect: target } = Route.useSearch();
  return <AuthForm mode="signup" googleEnabled={googleEnabled} redirect={target} />;
}
