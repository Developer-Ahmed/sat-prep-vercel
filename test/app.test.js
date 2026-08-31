import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createApplication } from "../server/app.js";

function response() {
  const headers = new Map();
  return {
    headers,
    statusCode: 0,
    body: "",
    setHeader(name, value) { headers.set(String(name).toLowerCase(), value); },
    writeHead(status, values = {}) {
      this.statusCode = status;
      for (const [name, value] of Object.entries(values)) this.setHeader(name, value);
    },
    end(value = "") { this.body += Buffer.isBuffer(value) ? value.toString("utf8") : String(value); }
  };
}

function database() {
  return {
    runAsUser(_userId, callback) { return callback(); },
    prepare() { return { async run() { return { changes: 1 }; } }; }
  };
}

function authentication({ signedIn = false } = {}) {
  return {
    authorizedParties: () => ["https://sat.example.com"],
    async authenticateRequest() { return signedIn ? { userId: "user_12345678" } : null; },
    clerkPublicConfig: () => ({ configured: true, publishableKey: "pk_test_x", frontendApi: "test.example" }),
    isAdmin: () => false,
    async verifyClerkWebhook() { throw new Error("not used"); }
  };
}

const publicDir = fileURLToPath(new URL("../public", import.meta.url));

test("application factory serves public configuration with hardened no-store headers", async () => {
  const app = createApplication({ db: database(), publicDir, auth: authentication(), logger() {} });
  const res = response();
  await app.route({ method: "GET", url: "/api/auth-config", headers: { host: "sat.example.com" } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  assert.equal(JSON.parse(res.body).data.configured, true);
});

test("health check is public, minimal, and does not disclose infrastructure", async () => {
  const app = createApplication({ db: database(), publicDir, auth: authentication(), logger() {} });
  const res = response();
  await app.route({ method: "GET", url: "/api/health", headers: { host: "sat.example.com" } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { success: true, data: { status: "ok" } });
});

test("protected APIs fail closed and unknown pages return a real 404", async () => {
  const app = createApplication({ db: database(), publicDir, auth: authentication(), logger() {} });
  const apiResponse = response();
  await app.route({ method: "GET", url: "/api/status", headers: { host: "sat.example.com" } }, apiResponse);
  assert.equal(apiResponse.statusCode, 401);

  const pageResponse = response();
  await app.route({ method: "GET", url: "/not-a-real-page", headers: { host: "sat.example.com" } }, pageResponse);
  assert.equal(pageResponse.statusCode, 404);
  assert.match(pageResponse.body, /<!doctype html>/i);
});

test("authenticated cross-site mutations are rejected before feature routing", async () => {
  const app = createApplication({ db: database(), publicDir, auth: authentication({ signedIn: true }), logger() {} });
  const res = response();
  await app.route({
    method: "POST",
    url: "/api/not-a-real-route",
    headers: { host: "sat.example.com", origin: "https://attacker.example", "sec-fetch-site": "cross-site" }
  }, res);
  assert.equal(res.statusCode, 403);
  assert.equal(JSON.parse(res.body).code, "UNTRUSTED_ORIGIN");
});
