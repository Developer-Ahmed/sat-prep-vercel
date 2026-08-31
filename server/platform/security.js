import { HttpError } from "./http.js";

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' https://*.clerk.accounts.dev https://*.clerk.com https://challenges.cloudflare.com https://*.protect.clerk.com",
  "connect-src 'self' https://clerk-telemetry.com https://*.clerk-telemetry.com https://img.clerk.com https://*.clerk.accounts.dev https://*.clerk.com https://*.protect.clerk.com:*",
  "img-src 'self' data: https://img.clerk.com",
  "style-src 'self' 'unsafe-inline'",
  "worker-src 'self' blob:",
  "frame-src 'self' https://challenges.cloudflare.com https://*.protect.clerk.com",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'"
].join("; ");

export const SECURITY_HEADERS = Object.freeze({
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-DNS-Prefetch-Control": "off",
  "X-Frame-Options": "DENY"
});

export function applySecurityHeaders(res) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
}

export function enforceTrustedOrigin(req, trustedOrigins) {
  const method = String(req.method || "GET").toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return;

  const fetchSite = String(req.headers?.["sec-fetch-site"] || "").toLowerCase();
  if (fetchSite === "cross-site") {
    throw new HttpError(403, "UNTRUSTED_ORIGIN", "The request origin is not allowed.");
  }

  const origin = String(req.headers?.origin || "").trim();
  if (!origin) return;
  let normalized;
  try {
    normalized = new URL(origin).origin;
  } catch {
    throw new HttpError(403, "UNTRUSTED_ORIGIN", "The request origin is not allowed.");
  }
  if (!trustedOrigins.includes(normalized)) {
    throw new HttpError(403, "UNTRUSTED_ORIGIN", "The request origin is not allowed.");
  }
}
