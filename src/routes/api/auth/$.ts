import { createFileRoute } from "@tanstack/react-router";

// Mounts better-auth at /api/auth/* (sign-in, sign-up, session, OAuth callbacks…).
// The server module is imported dynamically inside the handler so the client
// bundle never touches src/server/** (import-protection).
export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      ANY: async ({ request }) => {
        const { auth } = await import("@/server/auth");
        return auth.handler(request);
      },
    },
  },
});
