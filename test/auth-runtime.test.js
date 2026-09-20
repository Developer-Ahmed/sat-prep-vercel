import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  PUBLIC_ROUTE_ROOTS,
  PROTECTED_ROUTE_ROOTS,
  SIGN_IN_PATH,
  clerkLoadOptions,
  isAuthenticationPath,
  isKnownPath,
  isPublicPath,
  isProtectedPath,
  subscribeToSignOut
} from "../public/shared/auth-runtime.js";

test("authentication routing recognizes every deployed application route", async () => {
  const vercel = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  const rewrites = new Set(vercel.rewrites.map(({ source }) => source));

  assert.deepEqual(PUBLIC_ROUTE_ROOTS, ["/", "/home", "/about"]);
  assert.deepEqual(PROTECTED_ROUTE_ROOTS, ["/math", "/english", "/vocab"]);
  for (const route of [...PUBLIC_ROUTE_ROOTS, ...PROTECTED_ROUTE_ROOTS].filter((route) => route !== "/")) {
    assert.ok(rewrites.has(route), `${route} must have a matching Vercel rewrite`);
  }
  for (const route of PROTECTED_ROUTE_ROOTS) {
    assert.equal(isProtectedPath(route), true);
  }
  assert.equal(isPublicPath("/"), true);
  assert.equal(isPublicPath("/about"), true);
  assert.equal(isProtectedPath("/mathematics"), false);
  assert.equal(isProtectedPath("/math/extra"), false);
  assert.equal(isKnownPath("/missing"), false);
});

test("authentication routes accept Clerk subpaths without accepting lookalikes", () => {
  assert.equal(isAuthenticationPath("/sign-in"), true);
  assert.equal(isAuthenticationPath("/sign-in/factor-one"), true);
  assert.equal(isAuthenticationPath("/sign-up/verify-email-address"), true);
  assert.equal(isAuthenticationPath("/sign-injected"), false);
});

test("Clerk receives the sign-out redirect as a global load option", () => {
  const ClerkUI = {};
  assert.deepEqual(clerkLoadOptions({ ClerkUI, proxyUrl: "https://example.com/__clerk" }), {
    ui: { ClerkUI },
    afterSignOutUrl: SIGN_IN_PATH,
    proxyUrl: "https://example.com/__clerk"
  });
});

test("sign-out subscription reacts once only after Clerk clears the session", () => {
  let listener;
  let signOuts = 0;
  const unsubscribe = () => {};
  const clerk = {
    addListener(callback) {
      listener = callback;
      return unsubscribe;
    }
  };

  assert.equal(subscribeToSignOut(clerk, () => { signOuts += 1; }), unsubscribe);
  listener({ session: undefined, user: undefined });
  listener({ session: {}, user: {} });
  assert.equal(signOuts, 0);
  listener({ session: null, user: null });
  listener({ session: null, user: null });
  assert.equal(signOuts, 1);
});
