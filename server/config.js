import { proxySettings } from "./clerk-proxy.js";

function required(env, name) {
  const value = String(env[name] || "").trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function postgresUrl(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid PostgreSQL connection URL.`);
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error(`${name} must use the PostgreSQL protocol.`);
  }
  return url;
}

export function isProduction(env = process.env) {
  return env.VERCEL_ENV === "production" || (!env.VERCEL && env.NODE_ENV === "production");
}

export function validateRuntimeConfiguration(env = process.env) {
  const databaseValue = required(env, "DATABASE_URL");
  const databaseUrl = postgresUrl(databaseValue, "DATABASE_URL");
  const publishableKey = required(env, "CLERK_PUBLISHABLE_KEY");
  const secretKey = required(env, "CLERK_SECRET_KEY");
  const parties = required(env, "CLERK_AUTHORIZED_PARTIES")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const proxy = proxySettings(env);

  if (!/^pk_(?:test|live)_[A-Za-z0-9_-]+$/.test(publishableKey)) {
    throw new Error("CLERK_PUBLISHABLE_KEY has an invalid format.");
  }
  if (!/^sk_(?:test|live)_[A-Za-z0-9_-]{16,}$/.test(secretKey)) {
    throw new Error("CLERK_SECRET_KEY has an invalid format.");
  }
  if (!parties.length || parties.some((value) => {
    try {
      return new URL(value).origin !== value;
    } catch {
      return true;
    }
  })) {
    throw new Error("CLERK_AUTHORIZED_PARTIES must contain exact origins without paths.");
  }

  if (proxy.enabled) {
    if (!publishableKey.startsWith("pk_live_") || !/^sk_live_[A-Za-z0-9_-]{16,}$/.test(secretKey)) {
      throw new Error("The Clerk proxy requires matching live publishable and secret keys.");
    }
    if (!parties.includes(proxy.origin)) {
      throw new Error("CLERK_PROXY_URL origin must be included in CLERK_AUTHORIZED_PARTIES.");
    }
    if (String(env.CLERK_FAPI_URL || "").trim()) {
      const fapiUrl = new URL(env.CLERK_FAPI_URL);
      if (
        isProduction(env)
        && (
          fapiUrl.origin !== "https://frontend-api.clerk.dev"
          || fapiUrl.pathname !== "/"
          || fapiUrl.username
          || fapiUrl.password
          || fapiUrl.search
          || fapiUrl.hash
        )
      ) {
        throw new Error("Production CLERK_FAPI_URL must use Clerk's official Frontend API origin.");
      }
    }
  }

  if (isProduction(env)) {
    if (databaseUrl.searchParams.get("sslmode") !== "require") {
      throw new Error("Production DATABASE_URL must require TLS with sslmode=require.");
    }
    if (!databaseUrl.hostname.includes("-pooler.")) {
      throw new Error("Production DATABASE_URL must use Neon's pooled runtime endpoint.");
    }
    if (!publishableKey.startsWith("pk_live_")) {
      throw new Error("Production must use a Clerk live publishable key.");
    }
    if (!secretKey.startsWith("sk_live_")) {
      throw new Error("Production must use a Clerk live secret key.");
    }
    const webhookSecret = required(env, "CLERK_WEBHOOK_SIGNING_SECRET");
    if (!/^whsec_[A-Za-z0-9+/=_-]{16,}$/.test(webhookSecret)) {
      throw new Error("CLERK_WEBHOOK_SIGNING_SECRET has an invalid format.");
    }
    if (parties.some((value) => new URL(value).protocol !== "https:")) {
      throw new Error("Production Clerk authorized parties must use HTTPS.");
    }
    if (parties.some((value) => new URL(value).hostname.endsWith(".vercel.app")) && !proxy.enabled) {
      throw new Error("Production on a vercel.app domain requires CLERK_PROXY_URL.");
    }
    if (String(env.DATABASE_ADMIN_URL || "").trim()) {
      throw new Error("DATABASE_ADMIN_URL must not be available to the production application runtime.");
    }
  }

  return Object.freeze({ production: isProduction(env), authorizedParties: parties, clerkProxyEnabled: proxy.enabled });
}
