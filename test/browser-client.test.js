import test from "node:test";
import assert from "node:assert/strict";

import { escapeHtml, parseJsonResponse, requestJson } from "../public/shared/browser.js";

function response(body, { status = 200, ok = status >= 200 && status < 300 } = {}) {
  return {
    status,
    ok,
    async text() {
      return body;
    }
  };
}

test("browser text escaping covers every HTML-sensitive character", () => {
  assert.equal(escapeHtml(`<script data-x="'">&`), "&lt;script data-x=&quot;&#039;&quot;&gt;&amp;");
  assert.equal(escapeHtml(null), "");
});

test("browser response parsing returns only successful envelope data", async () => {
  const data = await parseJsonResponse(response('{"success":true,"data":{"count":2}}'));
  assert.deepEqual(data, { count: 2 });

  await assert.rejects(
    parseJsonResponse(response('{"success":false,"error":"Invalid request"}', { status: 400 })),
    /Invalid request/
  );
});

test("expired browser sessions redirect even when the response is not JSON", async () => {
  let redirected = 0;
  await assert.rejects(
    parseJsonResponse(response("Unauthorized", { status: 401 }), {
      onUnauthorized() {
        redirected += 1;
      }
    }),
    /session expired/i
  );
  assert.equal(redirected, 1);
});

test("invalid browser responses use a bounded deployment error", async () => {
  await assert.rejects(
    parseJsonResponse(response("Temporary upstream failure", { status: 502 }), { resourceLabel: "SAT data" }),
    /returned 502 instead of SAT data/
  );
});

test("browser requests always ask for JSON and send same-origin credentials", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  let captured;
  globalThis.fetch = async (path, options) => {
    captured = { path, options };
    return response('{"success":true,"data":null}');
  };

  await requestJson("/api/status", { headers: { "x-requested-with": "test" } });
  assert.equal(captured.path, "/api/status");
  assert.equal(captured.options.credentials, "same-origin");
  assert.equal(captured.options.headers.get("accept"), "application/json");
  assert.equal(captured.options.headers.get("x-requested-with"), "test");
});
