#!/usr/bin/env node
//
// Fail the build when the SSR bundle contains the shape that took prod down on
// 2026-08-29 (deploy #24).
//
// THE SHAPE. Rollup sometimes emits two SSR chunks that import each other: one
// defines the `__exportAll` helper (synthesised for a module imported as a
// NAMESPACE, which our handlers do constantly — `await import("@/database/
// schema")`), the other imports that helper and CALLS IT AT TOP LEVEL. ESM
// evaluates a module's imports before its body, so whichever chunk is entered
// first decides whether the helper exists yet. Enter the defining one first and
// every SSR request dies with `TypeError: __exportAll is not a function`.
//
// It is composition-dependent, which is the nasty part: the cycle is present in
// healthy builds too and lands the right way up by luck. The trigger last time
// was DELETING an import from a route — a change that removed code broke the
// build. Nobody can be expected to predict that, so it is detected instead.
//
// Run after a production build. Exits 1 when a cycle is found whose members
// call an imported helper at top level.

import { readdirSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

const DIR = ".output/server/_ssr";

let files;
try {
  files = readdirSync(DIR).filter((f) => f.endsWith(".mjs"));
} catch {
  console.error(`✗ ${DIR} not found — run a production build first:`);
  console.error("  NODE_ENV=production NITRO_PRESET=node-server npm run build");
  process.exit(2);
}

const graph = new Map();
const callsHelperAtTopLevel = new Set();

for (const file of files) {
  const src = readFileSync(`${DIR}/${file}`, "utf8");
  const deps = [...src.matchAll(/from\s+"(\.[^"]+\.mjs)"/g)].map((m) =>
    basename(resolve(dirname(`${DIR}/${file}`), m[1])),
  );
  graph.set(file, new Set(deps));
  const importsHelper = /import \{[^}]*\bas __exportAll(\$\d+)?\b/.test(src);
  const topLevelCall = /^var \w+ = \/\* @__PURE__ \*\/ __exportAll(\$\d+)?\(/m.test(src);
  if (importsHelper && topLevelCall) callsHelperAtTopLevel.add(file);
}

const pairs = [];
for (const [a, deps] of graph) {
  for (const b of deps) {
    if (a < b && graph.get(b)?.has(a)) pairs.push([a, b]);
  }
}

const dangerous = pairs.filter(([a, b]) => callsHelperAtTopLevel.has(a) || callsHelperAtTopLevel.has(b));

console.log(`bundle: ${files.length} SSR chunks · ${pairs.length} mutually-importing pair(s)`);
for (const [a, b] of pairs) {
  const risky = [a, b].filter((f) => callsHelperAtTopLevel.has(f));
  console.log(`  ${a} <-> ${b}${risky.length ? `   ⚠ top-level helper call in ${risky.join(", ")}` : "   (benign)"}`);
}

if (dangerous.length > 0) {
  console.error(
    "\n✗ This bundle can fail at runtime with `__exportAll is not a function`.\n" +
      "  Two chunks import each other and one calls the helper before the other's body runs.\n" +
      "  It is a CHUNKING outcome, not a bug in a specific file: change what the entry\n" +
      "  graph looks like (add or remove an import in a route) and re-check. See\n" +
      "  doc/BACKLOG.md → 'The prod bundle has a latent chunk cycle'.",
  );
  process.exit(1);
}
console.log("✓ no dangerous chunk cycle");
