// Account types (Phase V · V03) — pure and client-safe.
//
// Until V03 every account was a buyer's: `individual` (a personal workspace)
// or `organization` (a company workspace). Both are WORKSPACE accounts — the
// person acts inside a workspace, on a plan, as a customer.
//
// The V6 parcours has two more lanes, and their people are not customers:
//
//   supplier   someone at a supplier, answering the RFQs sent to that supplier
//   partner    someone at a partner (transport, inspection…) — V21
//
// These are EXTERNAL accounts. An external account belongs to no workspace,
// has no plan and no quota, and can do nothing a customer can: it never
// creates a request, never reads a dossier, never sees another supplier. It
// reaches the platform through its own surface (`/portail` for a supplier,
// `/partenaires` for a partner — V23) and its own guard
// (`src/server/party-guard.ts`) — owner, 2026-11-18: "supplier cannot act as
// workspace like a customer, the account type is supplier".
//
// The type is set when the account is created and is never changed: there is
// no upgrading a supplier into a buyer, and a person who is both holds two
// accounts.

export const WORKSPACE_ACCOUNT_TYPES = ["individual", "organization"] as const;
export const EXTERNAL_ACCOUNT_TYPES = ["supplier", "partner"] as const;
export const ACCOUNT_TYPES = [...WORKSPACE_ACCOUNT_TYPES, ...EXTERNAL_ACCOUNT_TYPES] as const;

export type WorkspaceAccountType = (typeof WORKSPACE_ACCOUNT_TYPES)[number];
export type ExternalAccountType = (typeof EXTERNAL_ACCOUNT_TYPES)[number];
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/**
 * Which kind of external account this is — null for a workspace account.
 *
 * Deliberately strict about what counts as a workspace account: only the two
 * known values (and a missing one, which is how accounts created before the
 * column existed, and social sign-ups, read). Any OTHER string is treated as
 * external-and-unknown by `isExternalAccount` below — a value nobody
 * recognises must never be given a customer's rights by default.
 */
export function externalKind(accountType: string | null | undefined): ExternalAccountType | null {
  return (EXTERNAL_ACCOUNT_TYPES as readonly string[]).includes(accountType ?? "")
    ? (accountType as ExternalAccountType)
    : null;
}

/** True unless the account is a known workspace account. */
export function isExternalAccount(accountType: string | null | undefined): boolean {
  if (accountType === null || accountType === undefined || accountType === "") return false;
  return !(WORKSPACE_ACCOUNT_TYPES as readonly string[]).includes(accountType);
}

// ── where an external session may go ────────────────────────────────────────

/** The supplier accounts' own surface. */
export const PORTAL_PREFIX = "/portail";
/** The partner accounts' own surface — the Partner Hub (V23). Not
 *  `/interne/partenaires`, which is where STAFF keep the partners. */
export const PARTNER_HUB_PREFIX = "/partenaires";

const SURFACE: Record<ExternalAccountType, string> = {
  supplier: PORTAL_PREFIX,
  partner: PARTNER_HUB_PREFIX,
};

/** Where an external account lands, and is sent back to from anywhere else. */
export function externalHome(kind: ExternalAccountType): string {
  return SURFACE[kind];
}

function under(prefix: string, pathname: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Pages an external session may open besides its surface: the ones that deal
 *  with the account itself. `/` is NOT among them — the landing's loader reads
 *  buyer data, and an external session has no business on a buyer's page. */
const EXTERNAL_OPEN_PATHS = ["/login", "/mot-de-passe-oublie", "/reinitialiser", "/2fa"];

/**
 * May an external session of this kind open this path?
 *
 * An allow list: everything the product has, and everything it will ever
 * add, is closed to an external account unless it is written here. And each
 * kind has ITS surface only (V23): a supplier's person has no partner to
 * answer for, a partner's person no RFQ — the other surface is as closed to
 * them as a buyer's page.
 */
export function externalMayOpen(pathname: string, kind: ExternalAccountType): boolean {
  return (
    under(SURFACE[kind], pathname) ||
    pathname.startsWith("/api/") ||
    EXTERNAL_OPEN_PATHS.includes(pathname)
  );
}

/** The supplier portal is the supplier accounts' and nobody else's. The
 *  public pages under it (the invitation link, V15) are opened by
 *  `isPublicPath`, before this is asked. */
export function isPortalPath(pathname: string): boolean {
  return under(PORTAL_PREFIX, pathname);
}

/** The Partner Hub, likewise (V23). */
export function isPartnerHubPath(pathname: string): boolean {
  return under(PARTNER_HUB_PREFIX, pathname);
}

/** Either external surface: where a buyer or a staff member has no business,
 *  and where the app's own sidebar is not shown. */
export function isExternalSurfacePath(pathname: string): boolean {
  return isPortalPath(pathname) || isPartnerHubPath(pathname);
}
