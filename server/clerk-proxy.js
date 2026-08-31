import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { clerkFrontendApiProxy } from "@clerk/backend/proxy";

export const CLERK_PROXY_PATH = "/__clerk";
const MAX_PROXY_URL_LENGTH = 12 * 1024;
const ALLOWED_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

function firstHeader(value) {
  return String(value || "").split(",", 1)[0].trim();
}

function productionEnvironment(env) {
  return env.VERCEL_ENV === "production" || (!env.VERCEL && env.NODE_ENV === "production");
}

function proxyCredentials(env) {
  const publishableKey = String(env.CLERK_PUBLISHABLE_KEY || "").trim();
  const secretKey = String(env.CLERK_SECRET_KEY || "").trim();
  if (!publishableKey || !secretKey) throw new Error("The Clerk proxy credentials are missing.");
  if (productionEnvironment(env) && (!publishableKey.startsWith("pk_live_") || !secretKey.startsWith("sk_live_"))) {
    throw new Error("Production Clerk proxy credentials must use live keys.");
  }
  return { publishableKey, secretKey };
}

function frontendApiUrl(env) {
  const value = String(env.CLERK_FAPI_URL || "").trim();
  if (!value) return "";
  const url = new URL(value);
  if (
    productionEnvironment(env)
    && (
      url.origin !== "https://frontend-api.clerk.dev"
      || url.pathname !== "/"
      || url.username
      || url.password
      || url.search
      || url.hash
    )
  ) {
    throw new Error("Production Clerk proxy traffic must use Clerk's official Frontend API.");
  }
  return value;
}

export function proxySettings(env = process.env) {
  const value = String(env.CLERK_PROXY_URL || "").trim();
  if (!value) return Object.freeze({ enabled: false, publicPath: "" });

  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("CLERK_PROXY_URL must be a valid absolute URL.");
  }
  const normalizedPath = url.pathname.replace(/\/+$/, "") || "/";
  if (url.protocol !== "https:" && productionEnvironment(env)) {
    throw new Error("Production CLERK_PROXY_URL must use HTTPS.");
  }
  if (url.username || url.password || url.search || url.hash || normalizedPath !== CLERK_PROXY_PATH) {
    throw new Error(`CLERK_PROXY_URL must be an origin followed by ${CLERK_PROXY_PATH}.`);
  }
  return Object.freeze({
    enabled: true,
    origin: url.origin,
    proxyUrl: `${url.origin}${CLERK_PROXY_PATH}`,
    publicPath: CLERK_PROXY_PATH
  });
}

export function restoreProxyRequestUrl(rawUrl) {
  const url = new URL(rawUrl || "/", "https://proxy.invalid");
  const forwardedPath = url.searchParams.get("__clerk_path");
  if (forwardedPath === null) throw new Error("The Clerk proxy route is missing its forwarded path.");
  url.searchParams.delete("__clerk_path");

  const path = forwardedPath.replace(/^\/+/, "");
  if (
    path.length > MAX_PROXY_URL_LENGTH
    || /[\\?#\u0000-\u001f\u007f]/.test(path)
    || path.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    throw new Error("The Clerk proxy path is invalid.");
  }

  const query = url.searchParams.toString();
  return `${CLERK_PROXY_PATH}${path ? `/${path}` : ""}${query ? `?${query}` : ""}`;
}

function requestOrigin(req) {
  const protocol = firstHeader(req.headers?.["x-forwarded-proto"])
    || (req.socket?.encrypted ? "https" : "http");
  const host = firstHeader(req.headers?.["x-forwarded-host"])
    || firstHeader(req.headers?.host)
    || "localhost";
  if (!['http', 'https'].includes(protocol.toLowerCase())) throw new Error("Invalid forwarded protocol.");
  return new URL(`${protocol}://${host}`).origin;
}

function webHeaders(req, env) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers || {})) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, String(item)));
    else if (value != null) headers.set(name, String(value));
  }

  if (env.VERCEL) {
    // Vercel overwrites this header at its edge to prevent client IP spoofing.
    const clientIp = firstHeader(headers.get("x-vercel-forwarded-for") || headers.get("x-forwarded-for"));
    headers.delete("cf-connecting-ip");
    if (clientIp) {
      headers.set("x-forwarded-for", clientIp);
      headers.set("x-real-ip", clientIp);
    }
  }
  return headers;
}

export function toWebRequest(req, env = process.env) {
  const method = String(req.method || "GET").toUpperCase();
  if (!ALLOWED_METHODS.has(method)) throw new Error("Unsupported Clerk proxy method.");
  const settings = proxySettings(env);
  if (!settings.enabled) throw new Error("The Clerk proxy is not configured.");

  const origin = requestOrigin(req);
  if (productionEnvironment(env) && origin !== settings.origin) {
    throw new Error("The request origin does not match CLERK_PROXY_URL.");
  }

  const url = new URL(req.url || CLERK_PROXY_PATH, origin);
  if (url.pathname !== CLERK_PROXY_PATH && !url.pathname.startsWith(`${CLERK_PROXY_PATH}/`)) {
    throw new Error("The request is outside the Clerk proxy path.");
  }

  const init = {
    method,
    headers: webHeaders(req, env),
    redirect: "manual"
  };
  if (method !== "GET" && method !== "HEAD") {
    init.body = Readable.toWeb(req);
    init.duplex = "half";
  }
  return new Request(url, init);
}

async function writeWebResponse(res, response) {
  const setCookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [];
  response.headers.forEach((value, name) => {
    if (name.toLowerCase() !== "set-cookie") res.setHeader(name, value);
  });
  if (setCookies.length) res.setHeader("set-cookie", setCookies);

  // Authentication responses must never enter Vercel's shared CDN cache.
  res.setHeader("cdn-cache-control", "no-store");
  res.setHeader("vercel-cdn-cache-control", "no-store");
  res.statusCode = response.status;

  if (!response.body) {
    res.end();
    return;
  }
  await pipeline(Readable.fromWeb(response.body), res);
}

function unavailable(res, statusCode = 503) {
  const payload = JSON.stringify({
    errors: [{ code: "proxy_unavailable", message: "Authentication is temporarily unavailable." }]
  });
  res.statusCode = statusCode;
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("content-length", Buffer.byteLength(payload));
  res.setHeader("x-content-type-options", "nosniff");
  res.end(payload);
}

export function createClerkProxyHandler({ env = process.env, proxy = clerkFrontendApiProxy } = {}) {
  return async function handleClerkProxy(req, res) {
    try {
      const settings = proxySettings(env);
      if (!settings.enabled) return unavailable(res);
      if (!String(env.CLERK_PUBLISHABLE_KEY || "").trim() || !String(env.CLERK_SECRET_KEY || "").trim()) {
        return unavailable(res);
      }
      const credentials = proxyCredentials(env);
      const fapiUrl = frontendApiUrl(env);
      const request = toWebRequest(req, env);
      const response = await proxy(request, {
        proxyPath: CLERK_PROXY_PATH,
        ...credentials,
        ...(fapiUrl ? { fapiUrl } : {})
      });
      if (response.status >= 500) return unavailable(res, 502);
      await writeWebResponse(res, response);
    } catch {
      if (!res.headersSent) unavailable(res, 502);
      else res.destroy();
    }
  };
}

export const handleClerkProxy = createClerkProxyHandler();
