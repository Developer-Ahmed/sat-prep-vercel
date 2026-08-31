import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CONTENT_SECURITY_POLICY, SECURITY_HEADERS, enforceTrustedOrigin } from "../server/platform/security.js";

test("state-changing browser requests reject cross-site and unknown origins", () => {
  const trusted = ["https://sat.example.com"];
  assert.throws(
    () => enforceTrustedOrigin({ method: "POST", headers: { origin: "https://attacker.example" } }, trusted),
    (error) => error.statusCode === 403 && error.code === "UNTRUSTED_ORIGIN"
  );
  assert.throws(
    () => enforceTrustedOrigin({ method: "DELETE", headers: { "sec-fetch-site": "cross-site" } }, trusted),
    (error) => error.statusCode === 403
  );
  assert.doesNotThrow(() => enforceTrustedOrigin({
    method: "POST",
    headers: { origin: "https://sat.example.com", "sec-fetch-site": "same-origin" }
  }, trusted));
});

test("safe methods and non-browser clients remain usable", () => {
  assert.doesNotThrow(() => enforceTrustedOrigin({ method: "GET", headers: { origin: "https://attacker.example" } }, []));
  assert.doesNotThrow(() => enforceTrustedOrigin({ method: "POST", headers: {} }, ["https://sat.example.com"]));
});

test("security headers deny framing, object execution, and broad browser capabilities", () => {
  assert.match(CONTENT_SECURITY_POLICY, /object-src 'none'/);
  assert.match(CONTENT_SECURITY_POLICY, /frame-ancestors 'none'/);
  assert.equal(SECURITY_HEADERS["X-Frame-Options"], "DENY");
  assert.equal(SECURITY_HEADERS["X-Content-Type-Options"], "nosniff");
  assert.match(SECURITY_HEADERS["Permissions-Policy"], /camera=\(\)/);
});

test("Vercel serves the same CSP as the local server", async () => {
  const vercel = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  const configured = Object.fromEntries(vercel.headers[0].headers.map(({ key, value }) => [key, value]));
  assert.equal(configured["Content-Security-Policy"], CONTENT_SECURITY_POLICY);
  for (const name of Object.keys(SECURITY_HEADERS)) assert.equal(configured[name], SECURITY_HEADERS[name]);
});
