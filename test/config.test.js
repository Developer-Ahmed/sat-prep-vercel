import test from "node:test";
import assert from "node:assert/strict";
import { validateRuntimeConfiguration } from "../server/config.js";

const local = {
  DATABASE_URL: "postgresql://sat_app:password@ep-test-pooler.example/neondb?sslmode=require",
  CLERK_PUBLISHABLE_KEY: "pk_test_abc123",
  CLERK_SECRET_KEY: `sk_test_${"a".repeat(24)}`,
  CLERK_AUTHORIZED_PARTIES: "http://127.0.0.1:5174"
};

test("local configuration accepts test credentials and exact local origins", () => {
  assert.deepEqual(validateRuntimeConfiguration(local), {
    production: false,
    authorizedParties: ["http://127.0.0.1:5174"],
    clerkProxyEnabled: false
  });
});

test("production configuration requires live Clerk, TLS, pooling, HTTPS, and no owner credential", () => {
  const production = {
    ...local,
    VERCEL: "1",
    VERCEL_ENV: "production",
    CLERK_PUBLISHABLE_KEY: "pk_live_abc123",
    CLERK_SECRET_KEY: `sk_live_${"b".repeat(24)}`,
    CLERK_AUTHORIZED_PARTIES: "https://sat.example.com",
    CLERK_WEBHOOK_SIGNING_SECRET: `whsec_${"a".repeat(32)}`
  };
  assert.equal(validateRuntimeConfiguration(production).production, true);
  assert.throws(() => validateRuntimeConfiguration({ ...production, CLERK_PUBLISHABLE_KEY: "pk_test_abc123" }), /live publishable/);
  assert.throws(() => validateRuntimeConfiguration({ ...production, CLERK_SECRET_KEY: `sk_test_${"b".repeat(24)}` }), /live secret/);
  assert.throws(() => validateRuntimeConfiguration({ ...production, DATABASE_URL: production.DATABASE_URL.replace("sslmode=require", "sslmode=disable") }), /require TLS/);
  assert.throws(() => validateRuntimeConfiguration({ ...production, DATABASE_URL: production.DATABASE_URL.replace("-pooler", "") }), /pooled/);
  assert.throws(() => validateRuntimeConfiguration({ ...production, CLERK_AUTHORIZED_PARTIES: "http://sat.example.com" }), /HTTPS/);
  assert.throws(() => validateRuntimeConfiguration({ ...production, DATABASE_ADMIN_URL: "postgresql://owner:secret@example/db" }), /must not be available/);
});

test("authorized parties reject URLs with paths and malformed secret keys", () => {
  assert.throws(() => validateRuntimeConfiguration({ ...local, CLERK_AUTHORIZED_PARTIES: "http://127.0.0.1:5174/path" }), /exact origins/);
  assert.throws(() => validateRuntimeConfiguration({ ...local, CLERK_SECRET_KEY: "secret" }), /invalid format/);
});

test("Vercel provider domains fail closed unless the official Clerk proxy is complete", () => {
  const production = {
    ...local,
    VERCEL: "1",
    VERCEL_ENV: "production",
    CLERK_PUBLISHABLE_KEY: "pk_live_abc123",
    CLERK_SECRET_KEY: `sk_live_${"b".repeat(24)}`,
    CLERK_AUTHORIZED_PARTIES: "https://sat-prep.vercel.app",
    CLERK_WEBHOOK_SIGNING_SECRET: `whsec_${"a".repeat(32)}`
  };
  assert.throws(() => validateRuntimeConfiguration(production), /requires CLERK_PROXY_URL/);
  assert.throws(() => validateRuntimeConfiguration({
    ...production,
    CLERK_PROXY_URL: "https://sat-prep.vercel.app/__clerk",
    CLERK_SECRET_KEY: ""
  }), /CLERK_SECRET_KEY/);
  assert.throws(() => validateRuntimeConfiguration({
    ...production,
    CLERK_PROXY_URL: "https://other.vercel.app/__clerk",
    CLERK_SECRET_KEY: `sk_live_${"b".repeat(24)}`
  }), /included in CLERK_AUTHORIZED_PARTIES/);

  const configured = validateRuntimeConfiguration({
    ...production,
    CLERK_PROXY_URL: "https://sat-prep.vercel.app/__clerk",
    CLERK_SECRET_KEY: `sk_live_${"b".repeat(24)}`
  });
  assert.equal(configured.clerkProxyEnabled, true);
});

test("Clerk proxy configuration rejects unsafe URLs, test keys, and upstream overrides", () => {
  const base = {
    ...local,
    CLERK_PUBLISHABLE_KEY: "pk_live_abc123",
    CLERK_SECRET_KEY: `sk_live_${"b".repeat(24)}`,
    CLERK_AUTHORIZED_PARTIES: "https://sat.example.com",
    CLERK_PROXY_URL: "https://sat.example.com/__clerk"
  };
  assert.throws(() => validateRuntimeConfiguration({ ...base, CLERK_PROXY_URL: "https://user:pass@sat.example.com/__clerk" }), /origin followed/);
  assert.throws(() => validateRuntimeConfiguration({ ...base, CLERK_PROXY_URL: "https://sat.example.com/not-clerk" }), /origin followed/);
  assert.throws(() => validateRuntimeConfiguration({ ...base, CLERK_PUBLISHABLE_KEY: "pk_test_abc123" }), /matching live/);
  for (const fapiUrl of [
    "https://attacker.example",
    "https://frontend-api.clerk.dev/unexpected-path",
    "https://user:password@frontend-api.clerk.dev",
    "https://frontend-api.clerk.dev?target=other"
  ]) {
    assert.throws(() => validateRuntimeConfiguration({
      ...base,
      VERCEL: "1",
      VERCEL_ENV: "production",
      CLERK_WEBHOOK_SIGNING_SECRET: `whsec_${"a".repeat(32)}`,
      CLERK_FAPI_URL: fapiUrl
    }), /official Frontend API/);
  }
});
