import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Readable, Writable } from "node:stream";
import {
  CLERK_PROXY_PATH,
  createClerkProxyHandler,
  proxySettings,
  restoreProxyRequestUrl,
  toWebRequest
} from "../server/clerk-proxy.js";

class TestResponse extends Writable {
  constructor() {
    super();
    this.headers = new Map();
    this.statusCode = 0;
    this.chunks = [];
  }

  setHeader(name, value) {
    this.headers.set(String(name).toLowerCase(), value);
  }

  get headersSent() {
    return false;
  }

  _write(chunk, _encoding, callback) {
    this.chunks.push(Buffer.from(chunk));
    callback();
  }

  get body() {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

function request(url, { method = "GET", headers = {}, body = "" } = {}) {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  req.method = method;
  req.url = url;
  req.headers = headers;
  req.socket = { encrypted: false };
  return req;
}

function environment(overrides = {}) {
  return {
    VERCEL: "1",
    VERCEL_ENV: "production",
    CLERK_PUBLISHABLE_KEY: `pk_live_${"a".repeat(24)}`,
    CLERK_SECRET_KEY: `sk_live_${"b".repeat(24)}`,
    CLERK_PROXY_URL: "https://sat-prep.vercel.app/__clerk",
    ...overrides
  };
}

test("proxy URL restoration preserves Clerk paths and ordinary query parameters", () => {
  assert.equal(
    restoreProxyRequestUrl("/api/clerk?__clerk_path=npm%2F%40clerk%2Fui%401%2Fdist%2Fui.browser.js&v=1"),
    "/__clerk/npm/@clerk/ui@1/dist/ui.browser.js?v=1"
  );
  assert.equal(restoreProxyRequestUrl("/api/clerk?__clerk_path="), CLERK_PROXY_PATH);
  assert.throws(() => restoreProxyRequestUrl("/api/clerk"), /missing/);
  assert.throws(() => restoreProxyRequestUrl("/api/clerk?__clerk_path=..%2Fsecret"), /invalid/);
  assert.throws(() => restoreProxyRequestUrl("/api/clerk?__clerk_path=v1%5Csecret"), /invalid/);
  assert.throws(() => restoreProxyRequestUrl("/api/clerk?__clerk_path=v1%3Ftarget%3Dother"), /invalid/);
});

test("Vercel forwards the Clerk path under the private routing parameter only", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  const rewrite = config.rewrites.find(({ source }) => source.startsWith("/__clerk/"));

  assert.deepEqual(rewrite, {
    source: "/__clerk/:__clerk_path*",
    destination: "/api/clerk"
  });
});

test("proxy settings require the exact dedicated path", () => {
  assert.deepEqual(proxySettings({}), { enabled: false, publicPath: "" });
  assert.equal(proxySettings(environment()).publicPath, "/__clerk");
  assert.throws(() => proxySettings(environment({ CLERK_PROXY_URL: "https://sat-prep.vercel.app/api" })), /origin followed/);
});

test("request conversion enforces origin and replaces spoofable IP headers on Vercel", async () => {
  const req = request("/__clerk/v1/client", {
    method: "POST",
    body: "payload",
    headers: {
      host: "sat-prep.vercel.app",
      "x-forwarded-host": "sat-prep.vercel.app",
      "x-forwarded-proto": "https",
      "x-forwarded-for": "203.0.113.10",
      "x-vercel-forwarded-for": "198.51.100.7",
      "cf-connecting-ip": "192.0.2.99"
    }
  });
  const webRequest = toWebRequest(req, environment());
  assert.equal(webRequest.url, "https://sat-prep.vercel.app/__clerk/v1/client");
  assert.equal(webRequest.headers.get("x-forwarded-for"), "198.51.100.7");
  assert.equal(webRequest.headers.get("x-real-ip"), "198.51.100.7");
  assert.equal(webRequest.headers.get("cf-connecting-ip"), null);
  assert.equal(await webRequest.text(), "payload");

  assert.throws(() => toWebRequest(request("/__clerk/v1/client", {
    headers: { host: "preview.vercel.app", "x-forwarded-proto": "https" }
  }), environment()), /does not match/);
  assert.throws(() => toWebRequest(request("/api/private", {
    headers: { host: "sat-prep.vercel.app", "x-forwarded-proto": "https" }
  }), environment()), /outside/);
});

test("official proxy forwards to Clerk only, replaces secrets, rewrites redirects, and disables CDN caching", async () => {
  const originalFetch = globalThis.fetch;
  let forwarded;
  globalThis.fetch = async (url, options) => {
    forwarded = { url: String(url), options };
    return new Response("proxied", {
      status: 201,
      headers: {
        location: "https://frontend-api.clerk.dev/v1/client/next",
        "cache-control": "private, no-store",
        "content-type": "text/plain"
      }
    });
  };

  try {
    const req = request("/__clerk/v1/client?x=1", {
      method: "POST",
      body: "request-body",
      headers: {
        host: "sat-prep.vercel.app",
        "x-forwarded-host": "sat-prep.vercel.app",
        "x-forwarded-proto": "https",
        "x-forwarded-for": "198.51.100.7",
        "x-vercel-forwarded-for": "198.51.100.7",
        "clerk-secret-key": "attacker-value",
        connection: "keep-alive"
      }
    });
    const res = new TestResponse();
    await createClerkProxyHandler({ env: environment() })(req, res);

    assert.equal(forwarded.url, "https://frontend-api.clerk.dev/v1/client?x=1");
    assert.equal(forwarded.options.headers.get("clerk-secret-key"), environment().CLERK_SECRET_KEY);
    assert.equal(forwarded.options.headers.get("clerk-proxy-url"), "https://sat-prep.vercel.app/__clerk");
    assert.equal(forwarded.options.headers.get("x-forwarded-for"), "198.51.100.7");
    assert.equal(forwarded.options.headers.get("connection"), null);
    assert.equal(res.statusCode, 201);
    assert.equal(res.headers.get("location"), "https://sat-prep.vercel.app/__clerk/v1/client/next");
    assert.equal(res.headers.get("cdn-cache-control"), "no-store");
    assert.equal(res.headers.get("vercel-cdn-cache-control"), "no-store");
    assert.equal(res.body, "proxied");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("proxy preserves separate authentication cookies", async () => {
  const responseHeaders = new Headers();
  responseHeaders.append("set-cookie", "session=one; Path=/; HttpOnly; Secure; SameSite=Lax");
  responseHeaders.append("set-cookie", "client=two; Path=/; HttpOnly; Secure; SameSite=Lax");
  const proxy = async () => new Response("ok", { headers: responseHeaders });
  const res = new TestResponse();

  await createClerkProxyHandler({ env: environment(), proxy })(request("/__clerk/v1/client", {
    headers: {
      host: "sat-prep.vercel.app",
      "x-forwarded-host": "sat-prep.vercel.app",
      "x-forwarded-proto": "https"
    }
  }), res);

  assert.deepEqual(res.headers.get("set-cookie"), [
    "session=one; Path=/; HttpOnly; Secure; SameSite=Lax",
    "client=two; Path=/; HttpOnly; Secure; SameSite=Lax"
  ]);
});

test("missing proxy secrets fail closed without disclosing configuration", async () => {
  const res = new TestResponse();
  await createClerkProxyHandler({ env: environment({ CLERK_SECRET_KEY: "" }) })(request("/__clerk/v1/client", {
    headers: { host: "sat-prep.vercel.app", "x-forwarded-proto": "https" }
  }), res);
  assert.equal(res.statusCode, 503);
  assert.match(res.body, /temporarily unavailable/);
  assert.doesNotMatch(res.body, /CLERK_SECRET_KEY|sk_live/);
});

test("the standalone Vercel proxy rejects development keys and non-Clerk upstreams", async () => {
  for (const env of [
    environment({ CLERK_PUBLISHABLE_KEY: `pk_test_${"a".repeat(24)}` }),
    environment({ CLERK_FAPI_URL: "https://attacker.example" }),
    environment({ CLERK_FAPI_URL: "https://frontend-api.clerk.dev/unexpected-path" })
  ]) {
    const res = new TestResponse();
    await createClerkProxyHandler({ env })(request("/__clerk/v1/client", {
      headers: {
        host: "sat-prep.vercel.app",
        "x-forwarded-host": "sat-prep.vercel.app",
        "x-forwarded-proto": "https"
      }
    }), res);
    assert.equal(res.statusCode, 502);
    assert.match(res.body, /temporarily unavailable/);
    assert.doesNotMatch(res.body, /attacker|pk_test|CLERK/);
  }
});

test("upstream failures are sanitized before reaching the browser", async () => {
  const proxy = async () => new Response(JSON.stringify({
    errors: [{ message: "connect ECONNREFUSED internal-host:443" }]
  }), { status: 502, headers: { "content-type": "application/json" } });
  const res = new TestResponse();

  await createClerkProxyHandler({ env: environment(), proxy })(request("/__clerk/v1/client", {
    headers: {
      host: "sat-prep.vercel.app",
      "x-forwarded-host": "sat-prep.vercel.app",
      "x-forwarded-proto": "https"
    }
  }), res);

  assert.equal(res.statusCode, 502);
  assert.match(res.body, /temporarily unavailable/);
  assert.doesNotMatch(res.body, /ECONNREFUSED|internal-host/);
});
