import { randomUUID } from "node:crypto";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;
const REDACTED = "[REDACTED]";
const SECRET_ENV_NAMES = [
  "DATABASE_URL",
  "DATABASE_ADMIN_URL",
  "CLERK_SECRET_KEY",
  "CLERK_WEBHOOK_SIGNING_SECRET",
  "CLERK_JWT_KEY",
  "NEON_API_KEY"
];
const SENSITIVE_FIELD_PATTERN = /(?:authorization|cookie|database(?:_admin)?_url|password|secret|token|private[_-]?key)/i;

function redactString(value, env) {
  let output = String(value);
  for (const name of SECRET_ENV_NAMES) {
    const secret = String(env?.[name] || "");
    if (secret.length >= 8) output = output.split(secret).join(REDACTED);
  }
  return output
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"'`<>]+/gi, "[REDACTED_DATABASE_URL]")
    .replace(/\bsk_(?:test|live)_[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_CLERK_SECRET]")
    .replace(/\bwhsec_[A-Za-z0-9+/_=-]{8,}\b/g, "[REDACTED_WEBHOOK_SECRET]")
    .replace(/(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/gi, `$1${REDACTED}`);
}

export function redactLogValue(value, env = process.env, key = "", seen = new WeakSet()) {
  if (SENSITIVE_FIELD_PATTERN.test(key)) return REDACTED;
  if (typeof value === "string") return redactString(value, env);
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => redactLogValue(item, env, "", seen));
  if (typeof value !== "object") return redactString(value, env);
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  const sanitized = Object.fromEntries(
    Object.entries(value).map(([field, item]) => [field, redactLogValue(item, env, field, seen)])
  );
  seen.delete(value);
  return sanitized;
}

export function requestIdFor(req) {
  const supplied = String(req?.headers?.["x-request-id"] || "").trim();
  return REQUEST_ID_PATTERN.test(supplied) ? supplied : randomUUID();
}

export function logEvent(level, event, fields = {}) {
  const method = ["debug", "info", "warn", "error"].includes(level) ? level : "info";
  const payload = redactLogValue({
    timestamp: new Date().toISOString(),
    level: method,
    event,
    ...fields
  });
  console[method](JSON.stringify(payload));
}

export function errorLogFields(error) {
  return redactLogValue({
    errorName: error?.name || "Error",
    errorMessage: error?.message || String(error),
    errorCode: error?.code,
    stack: process.env.NODE_ENV === "production" ? undefined : error?.stack
  });
}
