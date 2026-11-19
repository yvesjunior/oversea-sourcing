import { describe, expect, it } from "vitest";
import {
  ACCOUNT_TYPES,
  externalHome,
  externalKind,
  externalMayOpen,
  isExternalAccount,
  isExternalSurfacePath,
  isPartnerHubPath,
  isPortalPath,
} from "@/lib/account-types";
import { isPublicPath } from "@/lib/auth-guard";
import { authRedirect } from "@/lib/auth-guard";
import type { SessionData } from "@/lib/session-fns";

describe("which accounts are external", () => {
  it("treats the two buyer types as workspace accounts, and a missing type too", () => {
    expect(isExternalAccount("individual")).toBe(false);
    expect(isExternalAccount("organization")).toBe(false);
    // Accounts created before the column existed, and social sign-ups.
    expect(isExternalAccount(undefined)).toBe(false);
    expect(isExternalAccount(null)).toBe(false);
    expect(isExternalAccount("")).toBe(false);
  });

  it("treats supplier and partner as external", () => {
    expect(isExternalAccount("supplier")).toBe(true);
    expect(isExternalAccount("partner")).toBe(true);
    expect(externalKind("supplier")).toBe("supplier");
    expect(externalKind("partner")).toBe("partner");
    expect(externalKind("individual")).toBeNull();
  });

  // A value nobody recognises must not be handed a customer's rights.
  it("treats an unknown type as external — and as no known kind", () => {
    expect(isExternalAccount("admin")).toBe(true);
    expect(isExternalAccount("Supplier")).toBe(true);
    expect(externalKind("admin")).toBeNull();
  });

  it("knows exactly four types", () => {
    expect([...ACCOUNT_TYPES]).toEqual(["individual", "organization", "supplier", "partner"]);
  });
});

describe("where an external session may go", () => {
  it("opens a supplier's portal and the pages about the account itself", () => {
    for (const path of ["/portail", "/portail/rfq/abc", "/login", "/2fa", "/reinitialiser"]) {
      expect(externalMayOpen(path, "supplier"), path).toBe(true);
    }
  });

  it("opens a partner's hub and the pages about the account itself", () => {
    for (const path of [
      "/partenaires",
      "/partenaires/dossier/abc",
      "/login",
      "/2fa",
      "/reinitialiser",
    ]) {
      expect(externalMayOpen(path, "partner"), path).toBe(true);
    }
  });

  // V23: a second external audience with a different need-to-know. Each kind
  // has ITS surface; the other one is as closed as a buyer's page.
  it("closes each surface to the other kind", () => {
    expect(externalMayOpen("/partenaires", "supplier")).toBe(false);
    expect(externalMayOpen("/partenaires/dossier/abc", "supplier")).toBe(false);
    expect(externalMayOpen("/portail", "partner")).toBe(false);
    expect(externalMayOpen("/portail/rfq/abc", "partner")).toBe(false);
  });

  it("closes everything a customer or a staff member uses, to both kinds", () => {
    for (const kind of ["supplier", "partner"] as const) {
      for (const path of [
        "/",
        "/demandes",
        "/demandes/3049",
        "/fournisseurs",
        "/soumissions",
        "/contrats",
        "/parametres",
        "/interne/packs",
        "/interne/parametres",
        // Where STAFF keep the partners — not the partners' own surface.
        "/interne/partenaires",
        "/signup",
        "/invitation/abc",
        // Paths that merely start with the same letters.
        "/portail-admin",
        "/partenaires-admin",
      ]) {
        expect(externalMayOpen(path, kind), `${kind} ${path}`).toBe(false);
      }
    }
  });

  it("recognises each surface's own paths", () => {
    expect(isPortalPath("/portail")).toBe(true);
    expect(isPortalPath("/portail/x")).toBe(true);
    expect(isPortalPath("/portails")).toBe(false);
    expect(isPartnerHubPath("/partenaires")).toBe(true);
    expect(isPartnerHubPath("/partenaires/dossier/x")).toBe(true);
    expect(isPartnerHubPath("/interne/partenaires")).toBe(false);
    expect(isPortalPath("/partenaires")).toBe(false);
    expect(isExternalSurfacePath("/portail")).toBe(true);
    expect(isExternalSurfacePath("/partenaires")).toBe(true);
    expect(isExternalSurfacePath("/demandes")).toBe(false);
  });

  it("sends each kind home to its own surface", () => {
    expect(externalHome("supplier")).toBe("/portail");
    expect(externalHome("partner")).toBe("/partenaires");
  });
});

describe("the root guard, for the four populations", () => {
  const session = (external: "supplier" | "partner" | null) =>
    ({ external, user: {}, session: {}, platformFeatures: [] }) as unknown as SessionData;

  it("sends an anonymous visitor to login, except on public pages", () => {
    expect(authRedirect(null, "/")).toBeNull();
    expect(authRedirect(null, "/login")).toBeNull();
    expect(authRedirect(null, "/demandes")).toBe("login");
    expect(authRedirect(null, "/portail")).toBe("login");
    expect(authRedirect(null, "/partenaires")).toBe("login");
    expect(authRedirect(null, "/partenaires/dossier/abc")).toBe("login");
  });

  it("opens both invitation links to someone with no account", () => {
    expect(isPublicPath("/portail/inscription/some-token")).toBe(true);
    expect(isPublicPath("/partenaires/inscription/some-token")).toBe(true);
    expect(authRedirect(null, "/partenaires/inscription/some-token")).toBeNull();
    // The hub itself is not public because its invitation page is.
    expect(isPublicPath("/partenaires")).toBe(false);
    expect(isPublicPath("/partenaires/dossier/abc")).toBe(false);
  });

  it("sends a supplier account to the portal from anywhere else", () => {
    expect(authRedirect(session("supplier"), "/portail")).toBeNull();
    for (const path of ["/", "/demandes/3049", "/interne/parametres", "/signup"]) {
      expect(authRedirect(session("supplier"), path), path).toBe("portal");
    }
    // The Partner Hub included.
    expect(authRedirect(session("supplier"), "/partenaires")).toBe("portal");
    expect(authRedirect(session("supplier"), "/partenaires/dossier/abc")).toBe("portal");
  });

  it("sends a partner account to the hub from anywhere else", () => {
    expect(authRedirect(session("partner"), "/partenaires")).toBeNull();
    expect(authRedirect(session("partner"), "/partenaires/dossier/abc")).toBeNull();
    for (const path of ["/", "/demandes/3049", "/interne/partenaires", "/soumissions", "/signup"]) {
      expect(authRedirect(session("partner"), path), path).toBe("hub");
    }
    // The supplier portal included.
    expect(authRedirect(session("partner"), "/portail")).toBe("hub");
    expect(authRedirect(session("partner"), "/portail/rfq/abc")).toBe("hub");
  });

  it("keeps buyers and staff out of both surfaces, and everything else as it was", () => {
    expect(authRedirect(session(null), "/portail")).toBe("home");
    expect(authRedirect(session(null), "/portail/rfq/abc")).toBe("home");
    expect(authRedirect(session(null), "/partenaires")).toBe("home");
    expect(authRedirect(session(null), "/partenaires/dossier/abc")).toBe("home");
    // Staff's own page about partners is theirs.
    expect(authRedirect(session(null), "/interne/partenaires")).toBeNull();
    expect(authRedirect(session(null), "/demandes")).toBeNull();
    expect(authRedirect(session(null), "/")).toBeNull();
    // A signed-in buyer may be the one who was invited.
    expect(authRedirect(session(null), "/partenaires/inscription/some-token")).toBeNull();
  });
});
