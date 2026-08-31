const TRANSIENT_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 12 * 1024 * 1024;

export class UpstreamRequestError extends Error {
  constructor(message, { statusCode = 502, upstreamStatus, cause } = {}) {
    super(message, { cause });
    this.name = "UpstreamRequestError";
    this.statusCode = statusCode;
    this.upstreamStatus = upstreamStatus;
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryDelay(attempt, baseDelayMs) {
  const exponential = baseDelayMs * (2 ** attempt);
  return exponential + Math.floor(Math.random() * Math.max(1, baseDelayMs));
}

function shouldRetry(error, attempt, retries) {
  if (attempt >= retries) return false;
  if (error instanceof UpstreamRequestError && error.upstreamStatus) {
    return TRANSIENT_STATUSES.has(error.upstreamStatus);
  }
  return error?.name === "AbortError" || error instanceof TypeError;
}

export async function requestJson(url, {
  method = "GET",
  body,
  headers = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retries = 2,
  baseDelayMs = 150,
  maxBytes = DEFAULT_MAX_BYTES,
  fetchImpl = globalThis.fetch
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required.");
  const target = String(url);

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(target, {
        method,
        headers: {
          accept: "application/json",
          "user-agent": "sat-prep-web/1.0",
          ...headers
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new UpstreamRequestError(`Upstream request failed with HTTP ${response.status}.`, {
          upstreamStatus: response.status
        });
      }

      const declaredLength = Number(response.headers.get("content-length") || 0);
      if (declaredLength > maxBytes) {
        throw new UpstreamRequestError("Upstream response exceeded the allowed size.");
      }

      const text = await response.text();
      if (Buffer.byteLength(text) > maxBytes) {
        throw new UpstreamRequestError("Upstream response exceeded the allowed size.");
      }
      try {
        return JSON.parse(text);
      } catch (error) {
        throw new UpstreamRequestError("Upstream service returned invalid JSON.", { cause: error });
      }
    } catch (error) {
      const normalized = error?.name === "AbortError"
        ? new UpstreamRequestError("Upstream request timed out.", { statusCode: 504, cause: error })
        : error;
      if (!shouldRetry(error, attempt, retries)) {
        if (normalized instanceof UpstreamRequestError) throw normalized;
        throw new UpstreamRequestError("Unable to reach the upstream service.", { cause: normalized });
      }
      await wait(retryDelay(attempt, baseDelayMs));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new UpstreamRequestError("Unable to reach the upstream service.");
}
