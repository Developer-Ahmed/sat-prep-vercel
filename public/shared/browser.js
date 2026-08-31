export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function redirectToSignIn() {
  window.location.assign("/sign-in");
}

export async function parseJsonResponse(response, {
  resourceLabel = "application data",
  onUnauthorized = redirectToSignIn
} = {}) {
  const text = await response.text();

  if (response.status === 401) {
    onUnauthorized();
    throw new Error("Your session expired. Sign in again.");
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`The server returned ${response.status || "an error"} instead of ${resourceLabel}. Check the deployment's API configuration.`);
  }

  if (!response.ok || !payload.success) {
    throw new Error(payload.error || `Request failed (${response.status}).`);
  }
  return payload.data;
}

export async function requestJson(path, options = {}, responseOptions = {}) {
  const headers = new Headers(options.headers);
  headers.set("accept", "application/json");
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers
  });
  return parseJsonResponse(response, responseOptions);
}
