import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { AuthForm } from "@/components/osi/AuthForm";
import { getAuthConfigFn } from "@/lib/session-fns";

const searchSchema = z.object({
  redirect: z.string().optional(),
});

export const Route = createFileRoute("/login")({
  validateSearch: searchSchema,
  // Already signed in? Straight to the app.
  beforeLoad: ({ context, search }) => {
    if (context.session) {
      throw redirect({ to: search.redirect ?? "/" });
    }
  },
  loader: () => getAuthConfigFn(),
  head: () => ({
    meta: [{ title: "Connexion | OSI" }, { name: "robots", content: "noindex" }],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { googleEnabled } = Route.useLoaderData();
  const { redirect: target } = Route.useSearch();
  return <AuthForm mode="signin" googleEnabled={googleEnabled} redirect={target} />;
}
