import { createClerkClient } from "@clerk/backend";
import { verifyWebhook } from "@clerk/backend/webhooks";
import { proxySettings } from "./clerk-proxy.js";

function decodeBase64Url(value) {
  return Buffer.from(String(value).replaceAll("-", "+").replaceAll("_", "/"), "base64");
}

function frontendApiFromPublishableKey(key = process.env.CLERK_PUBLISHABLE_KEY) {
  const encoded = String(key || "").replace(/^pk_(?:test|live)_/, "");
  if (!encoded) return "";
  try {
    return decodeBase64Url(encoded).toString("utf8").replace(/\$$/, "");
  } catch {
    return "";
  }
}

function normalizeOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

export function clerkPublicConfig() {
  const publishableKey = process.env.CLERK_PUBLISHABLE_KEY || "";
  const frontendApi = process.env.CLERK_FRONTEND_API || frontendApiFromPublishableKey(publishableKey);
  const proxyUrl = proxySettings().publicPath;
  return {
    configured: Boolean(publishableKey && frontendApi),
    publishableKey,
    frontendApi,
    proxyUrl
  };
}

export function authorizedParties(req) {
  const configured = String(process.env.CLERK_AUTHORIZED_PARTIES || "")
    .split(",")
    .map((value) => normalizeOrigin(value.trim()))
    .filter(Boolean);
  for (const vercelHost of [process.env.VERCEL_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL]) {
    const origin = normalizeOrigin(vercelHost ? `https://${vercelHost}` : "");
    if (origin && !configured.includes(origin)) configured.push(origin);
  }
  if (configured.length) return configured;

  if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
    throw new Error("CLERK_AUTHORIZED_PARTIES must be configured in production.");
  }
  return [normalizeOrigin(`http://${req.headers.host || "127.0.0.1:5174"}`)].filter(Boolean);
}

function requestUrl(req) {
  const forwardedProto = String(req.headers?.["x-forwarded-proto"] || "").split(",", 1)[0].trim();
  const protocol = forwardedProto || (req.socket?.encrypted ? "https" : "http");
  const forwardedHost = String(req.headers?.["x-forwarded-host"] || "").split(",", 1)[0].trim();
  const host = forwardedHost || req.headers?.host || "127.0.0.1";
  return `${protocol}://${host}${req.url || "/"}`;
}

function webRequest(req, body) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers || {})) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
    else if (value != null) headers.set(name, String(value));
  }
  const method = String(req.method || "GET").toUpperCase();
  return new Request(requestUrl(req), {
    method,
    headers,
    ...(body !== undefined && method !== "GET" && method !== "HEAD" ? { body } : {})
  });
}

function productionEnvironment() {
  return process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
}

export function validateAuthConfiguration() {
  const config = clerkPublicConfig();
  if (!config.configured) throw new Error("CLERK_PUBLISHABLE_KEY is not configured.");
  if (!String(process.env.CLERK_SECRET_KEY || "").trim()) {
    throw new Error("CLERK_SECRET_KEY is required for Clerk request authentication.");
  }
  if (productionEnvironment() && !String(process.env.CLERK_AUTHORIZED_PARTIES || "").trim()) {
    throw new Error("CLERK_AUTHORIZED_PARTIES is required in production.");
  }
}

let cachedClient;
let cachedClientIdentity = "";
function clerkBackendClient() {
  const publishableKey = String(process.env.CLERK_PUBLISHABLE_KEY || "").trim();
  const secretKey = String(process.env.CLERK_SECRET_KEY || "").trim();
  const identity = `${publishableKey}\u0000${secretKey}`;
  if (!cachedClient || cachedClientIdentity !== identity) {
    cachedClient = createClerkClient({ publishableKey, secretKey });
    cachedClientIdentity = identity;
  }
  return cachedClient;
}

export function createRequestAuthenticator({ getClient = clerkBackendClient } = {}) {
  return async function authenticateRequest(req) {
    validateAuthConfiguration();
    try {
      const state = await getClient().authenticateRequest(webRequest(req), {
        acceptsToken: "session_token",
        authorizedParties: authorizedParties(req)
      });
      if (!state.isAuthenticated) return null;
      const auth = state.toAuth();
      if (!auth.userId) return null;
      return {
        userId: String(auth.userId),
        sessionId: String(auth.sessionId || ""),
        claims: auth.sessionClaims || {}
      };
    } catch {
      return null;
    }
  };
}

export const authenticateRequest = createRequestAuthenticator();

export function isAdmin(userId) {
  const admins = new Set(
    String(process.env.ADMIN_USER_IDS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
  return admins.has(userId);
}

export async function verifyClerkWebhook(req, body) {
  const signingSecret = String(process.env.CLERK_WEBHOOK_SIGNING_SECRET || "").trim();
  if (!signingSecret) throw new Error("CLERK_WEBHOOK_SIGNING_SECRET is not configured.");
  return verifyWebhook(webRequest(req, body), { signingSecret });
}
