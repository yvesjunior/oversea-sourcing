import { describe, expect, it } from "vitest";
import {
  ACCOUNT_TYPES,
  externalKind,
  externalMayOpen,
  isExternalAccount,
  isPortalPath,
} from "@/lib/account-types";
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
  it("opens the portal and the pages about the account itself", () => {
    for (const path of ["/portail", "/portail/rfq/abc", "/login", "/2fa", "/reinitialiser"]) {
      expect(externalMayOpen(path), path).toBe(true);
    }
  });

  it("closes everything a customer or a staff member uses", () => {
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
      "/signup",
      "/invitation/abc",
      // Not the portal: a path that merely starts with the same letters.
      "/portail-admin",
    ]) {
      expect(externalMayOpen(path), path).toBe(false);
    }
  });

  it("recognises the portal's own paths", () => {
    expect(isPortalPath("/portail")).toBe(true);
    expect(isPortalPath("/portail/x")).toBe(true);
    expect(isPortalPath("/portails")).toBe(false);
  });
});

describe("the root guard, for the three populations", () => {
  const session = (external: "supplier" | "partner" | null) =>
    ({ external, user: {}, session: {}, platformFeatures: [] }) as unknown as SessionData;

  it("sends an anonymous visitor to login, except on public pages", () => {
    expect(authRedirect(null, "/")).toBeNull();
    expect(authRedirect(null, "/login")).toBeNull();
    expect(authRedirect(null, "/demandes")).toBe("login");
    expect(authRedirect(null, "/portail")).toBe("login");
  });

  it("sends an external account to the portal from anywhere else", () => {
    for (const kind of ["supplier", "partner"] as const) {
      expect(authRedirect(session(kind), "/portail")).toBeNull();
      expect(authRedirect(session(kind), "/")).toBe("portal");
      expect(authRedirect(session(kind), "/demandes/3049")).toBe("portal");
      expect(authRedirect(session(kind), "/interne/parametres")).toBe("portal");
      expect(authRedirect(session(kind), "/signup")).toBe("portal");
    }
  });

  it("keeps buyers and staff out of the portal, and everything else as it was", () => {
    expect(authRedirect(session(null), "/portail")).toBe("home");
    expect(authRedirect(session(null), "/portail/rfq/abc")).toBe("home");
    expect(authRedirect(session(null), "/demandes")).toBeNull();
    expect(authRedirect(session(null), "/")).toBeNull();
  });
});
