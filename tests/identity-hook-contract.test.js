/**
 * Contract guard for the client identity hook.
 *
 * `useIdentity()` returns `loading` — a falsy `undefined` from a mistyped name turns a
 * loading guard into a silent render of the wrong branch. AdminGate destructured
 * `isLoading`, so the "Administrator access required" panel flashed on every page load
 * while the session request was still in flight. There is no type-checker on these
 * .js files, so this suite reads the sources instead: every property a consumer reads
 * off the hook must exist in the hook's return object.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const hookSource = fs.readFileSync(path.join(root, "hooks", "useIdentity.js"), "utf8");

/** Top-level keys of the object the hook returns (the block that declares `isSignedIn`). */
function returnedKeys(source) {
  const anchor = source.indexOf("isSignedIn: Boolean(state.identity)");
  assert.ok(anchor > 0, "useIdentity returns an isSignedIn field — update this test if it does not");

  const start = source.lastIndexOf("return {", anchor);
  const end = source.indexOf("\n};", anchor);
  const block = source.slice(start, end);

  // Both `key: value` and shorthand `key,` entries — `refresh` and `signInWithWallet`
  // are returned as shorthand, and a colon-only pattern would miss them.
  const explicit = [...block.matchAll(/^\s{4}([A-Za-z0-9_]+)\s*[,:]/gm)].map((match) => match[1]);

  // `...state` spreads the shape declared in useState, which is where `loading` lives.
  const spread = [];
  if (/\.\.\.state\b/.test(block)) {
    const initial = source.match(/useState\(\{([^}]*)\}\)/);
    if (initial) spread.push(...[...initial[1].matchAll(/([A-Za-z0-9_]+)\s*:/g)].map((match) => match[1]));
  }

  return new Set([...explicit, ...spread]);
}

/** Every .js file under a directory, skipping build output and dependencies. */
function sourceFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", "data", ".git"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

const returned = returnedKeys(hookSource);

test("the hook exposes the fields its documentation promises", () => {
  for (const field of ["loading", "identity", "isAdmin", "isSignedIn", "connectedAddress", "refresh"]) {
    assert.ok(returned.has(field), `useIdentity returns ${field}`);
  }
  assert.equal(returned.has("isLoading"), false, "the hook deliberately exposes `loading`, not `isLoading`");
});

test("every field destructured from useIdentity is one the hook returns", () => {
  const consumers = [
    ...sourceFiles(path.join(root, "components")),
    ...sourceFiles(path.join(root, "pages")),
    ...sourceFiles(path.join(root, "hooks")),
  ].filter((file) => !file.endsWith("useIdentity.js"));

  let checked = 0;
  const unknown = [];

  for (const file of consumers) {
    const source = fs.readFileSync(file, "utf8");
    const relative = path.relative(root, file);

    for (const match of source.matchAll(/const\s+\{([^}]*)\}\s*=\s*useIdentity\(\)/g)) {
      for (const raw of match[1].split(",")) {
        const name = raw.trim().split(":")[0].trim();
        if (!name || name.startsWith("...")) continue;
        checked += 1;
        if (!returned.has(name)) unknown.push(`${relative} destructures ${name}`);
      }
    }

    // `const identity = useIdentity()` — every property read off it must exist too.
    if (/const\s+identity\s*=\s*useIdentity\(\)/.test(source)) {
      for (const match of source.matchAll(/\bidentity\.([A-Za-z0-9_]+)/g)) {
        checked += 1;
        if (!returned.has(match[1])) unknown.push(`${relative} reads identity.${match[1]}`);
      }
    }
  }

  assert.ok(checked > 0, "expected at least one useIdentity consumer");
  assert.deepEqual(unknown, [], "these properties are not returned by useIdentity and render as undefined");
});
