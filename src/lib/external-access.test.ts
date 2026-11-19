// V03's acceptance, the part that can be checked without a database: an
// external account's session is refused by every server function that is not
// explicitly opened to it — and a function added tomorrow is covered too, or
// fails here until someone decides.
//
// It works on the SOURCE, like i18n-registry.test.ts, because the failure it
// guards against is not a wrong answer but a missing question: a function
// that never asks who is calling cannot be caught by calling it.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXTERNAL_ACCOUNT_CREATORS,
  EXTERNAL_API_ROUTES,
  EXTERNAL_AWARE_MODULES,
  EXTERNAL_FNS,
  PUBLIC_FNS,
} from "@/lib/external-access";

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (/\.tsx?$/.test(full) && !/\.test\.tsx?$/.test(full)) found.push(full);
  }
  return found;
}

const SOURCES = sourceFiles("src").map((file) => ({
  file: file.replaceAll("\\", "/"),
  text: readFileSync(file, "utf8"),
}));

/** The call every workspace-side session read goes through. */
const GUARDED = "auth.api.getSession(";

/**
 * Every helper that reaches the guarded getter, directly or through another
 * helper — `requirePackStaff`, `requireOwnRequest`… A server function that
 * calls one of them asks who is calling, and refuses an external account.
 */
function gatedHelpers(): Set<string> {
  const bodies = new Map<string, string>();
  for (const { file, text } of SOURCES) {
    if (!file.startsWith("src/lib/") && !file.startsWith("src/server/")) continue;
    for (const match of text.matchAll(/^(?:export )?(?:async )?function (\w+)\s*[(<]/gm)) {
      const end = text.indexOf("\n}\n", match.index);
      bodies.set(match[1]!, text.slice(match.index, end > 0 ? end : undefined));
    }
  }
  const gated = new Set<string>();
  for (const [name, body] of bodies) if (body.includes(GUARDED)) gated.add(name);
  for (let grew = true; grew;) {
    grew = false;
    for (const [name, body] of bodies) {
      if (gated.has(name)) continue;
      if ([...gated].some((helper) => new RegExp(`\\b${helper}\\(`).test(body))) {
        gated.add(name);
        grew = true;
      }
    }
  }
  return gated;
}

/** Every exported server function, with the source of its definition. */
function serverFns(): Array<{ name: string; file: string; source: string }> {
  const fns: Array<{ name: string; file: string; source: string }> = [];
  for (const { file, text } of SOURCES) {
    const starts = [...text.matchAll(/^export const (\w+) = createServerFn/gm)];
    starts.forEach((match, index) => {
      const next = starts[index + 1];
      fns.push({
        name: match[1]!,
        file,
        source: text.slice(match.index, next ? next.index : undefined),
      });
    });
  }
  return fns;
}

const FNS = serverFns();
const HELPERS = gatedHelpers();
const publicNames = Object.keys(PUBLIC_FNS);
const externalNames = Object.keys(EXTERNAL_FNS);

describe("every server function has decided who may call it", () => {
  it("finds the server functions at all", () => {
    // If the pattern above stops matching, every check below passes on nothing.
    expect(FNS.length).toBeGreaterThan(100);
    expect(HELPERS.size).toBeGreaterThan(5);
  });

  it("refuses external accounts unless it is listed as public or as external", () => {
    const undecided = FNS.filter(({ name, source }) => {
      if (publicNames.includes(name) || externalNames.includes(name)) return false;
      if (source.includes(GUARDED)) return false;
      return ![...HELPERS].some((helper) => new RegExp(`\\b${helper}\\(`).test(source));
    }).map(({ name, file }) => `${name} (${file})`);
    // A function here reads no session through the guarded getter. Either it
    // should — or it is public, or meant for external accounts, and belongs
    // in src/lib/external-access.ts with the reason.
    expect(undecided).toEqual([]);
  });

  it("lists as public only functions that really read no session", () => {
    for (const name of publicNames) {
      const fn = FNS.find((f) => f.name === name);
      expect(fn, `${name} is listed as public but does not exist`).toBeDefined();
      expect(fn!.source.includes("getSession"), `${name} reads a session`).toBe(false);
      expect(fn!.source.includes("getAnySession"), `${name} reads a session`).toBe(false);
    }
  });

  it("lists as external only functions that exist and never use the workspace getter", () => {
    for (const name of externalNames) {
      const fn = FNS.find((f) => f.name === name);
      expect(fn, `${name} is listed as external but does not exist`).toBeDefined();
      // Opened to external accounts means reading the session another way —
      // through the workspace getter it would simply refuse them.
      expect(fn!.source.includes(GUARDED), `${name} uses the workspace getter`).toBe(false);
      // Directly, or through the one helper its file defines for it
      // (`caller()` in portal-fns.ts, which is `requireSupplierSession`).
      const file = SOURCES.find((s) => s.file === fn!.file)!.text;
      const viaHelper =
        /\bawait caller\(\)/.test(fn!.source) &&
        /async function caller\(\)[\s\S]*?requireSupplierSession\(/.test(file);
      expect(
        viaHelper ||
          /getAnySession\(|requireSupplierSession\(|requirePartnerSession\(/.test(fn!.source),
        `${name} does not read an external session`,
      ).toBe(true);
    }
  });

  it("has no two server functions with the same name", () => {
    const names = FNS.map((f) => f.name);
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });
});

describe("the unguarded session getter stays where it was put", () => {
  it("is imported only by the modules written for external accounts", () => {
    // The register itself names the getter in its comments; it imports nothing.
    const importers = SOURCES.filter(({ file }) => file !== "src/lib/external-access.ts")
      .filter(
        ({ text }) =>
          /\bgetAnySession\b/.test(text) ||
          /from "@\/server\/party-guard"/.test(text) ||
          /import\("@\/server\/party-guard"\)/.test(text),
      )
      .map(({ file }) => file);
    expect(importers.sort()).toEqual([...EXTERNAL_AWARE_MODULES].sort());
  });

  it("is the only way around: nothing else reaches better-auth's own getter", () => {
    // `rawAuth` is not exported, so this is about someone exporting it, or
    // constructing a second better-auth instance, later.
    const offenders = SOURCES.filter(
      ({ file, text }) => file !== "src/server/auth.ts" && /\brawAuth\b|betterAuth\(/.test(text),
    ).map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});

describe("there is one way to become a supplier", () => {
  // No unsolicited supplier signup (V15): an external account comes from an
  // RFQ invitation, and from nothing else.
  it("lets only the invitation module create an external account", () => {
    const callers = SOURCES.filter(({ file }) => file !== "src/lib/external-access.ts")
      .filter(({ text }) => /\bcreateExternalAccount\b/.test(text))
      .map(({ file }) => file);
    expect(callers.sort()).toEqual([...EXTERNAL_ACCOUNT_CREATORS].sort());
  });

  it("keeps the public signup to buyer accounts", () => {
    const auth = SOURCES.find(({ file }) => file === "src/server/auth.ts")!.text;
    expect(auth).toContain('if (accountType !== "individual" && accountType !== "organization") {');
  });
});

describe("every API route asks who is calling", () => {
  it("reads its session through the guarded getter", () => {
    const external = EXTERNAL_API_ROUTES as readonly string[];
    const routes = SOURCES.filter(
      ({ file }) =>
        file.startsWith("src/routes/api/") &&
        !file.startsWith("src/routes/api/auth/") &&
        !external.includes(file),
    );
    expect(routes.length).toBeGreaterThan(3);
    for (const { file, text } of routes) {
      expect(text.includes(GUARDED), `${file} does not read a session`).toBe(true);
    }
  });

  it("guards the routes written for external accounts with the supplier guard, and only it", () => {
    for (const file of EXTERNAL_API_ROUTES) {
      const route = SOURCES.find((s) => s.file === file);
      expect(route, `${file} is listed but does not exist`).toBeDefined();
      expect(route!.text.includes("requireSupplierSession("), `${file} has no guard`).toBe(true);
      expect(route!.text.includes(GUARDED), `${file} uses the workspace getter`).toBe(false);
    }
    // And nothing under /api/portal/ escapes the list.
    const unlisted = SOURCES.filter(
      ({ file }) =>
        file.startsWith("src/routes/api/portal/") &&
        !(EXTERNAL_API_ROUTES as readonly string[]).includes(file),
    ).map(({ file }) => file);
    expect(unlisted).toEqual([]);
  });
});
