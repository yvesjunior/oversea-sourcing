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
// reaches the platform through its own surface (`/portail`) and its own guard
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

/** The external accounts' own surface. */
export const PORTAL_PREFIX = "/portail";

/** Pages an external session may open besides the portal: the ones that deal
 *  with the account itself. `/` is NOT among them — the landing's loader reads
 *  buyer data, and an external session has no business on a buyer's page. */
const EXTERNAL_OPEN_PATHS = ["/login", "/mot-de-passe-oublie", "/reinitialiser", "/2fa"];

/**
 * May an external session open this path?
 *
 * An allow list: everything the product has, and everything it will ever
 * add, is closed to an external account unless it is written here.
 */
export function externalMayOpen(pathname: string): boolean {
  return (
    pathname === PORTAL_PREFIX ||
    pathname.startsWith(`${PORTAL_PREFIX}/`) ||
    pathname.startsWith("/api/") ||
    EXTERNAL_OPEN_PATHS.includes(pathname)
  );
}

/** The portal is the external accounts' and nobody else's: a buyer or a staff
 *  member has no supplier to answer for. The public pages under it (the
 *  invitation link, V15) are opened by `isPublicPath`, before this is asked. */
export function isPortalPath(pathname: string): boolean {
  return pathname === PORTAL_PREFIX || pathname.startsWith(`${PORTAL_PREFIX}/`);
}
