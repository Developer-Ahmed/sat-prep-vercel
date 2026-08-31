import test from "node:test";
import assert from "node:assert/strict";
import { requestJson, UpstreamRequestError } from "../server/external-json.js";

test("requestJson parses a bounded JSON response", async () => {
  const result = await requestJson("https://example.test/data", {
    retries: 0,
    fetchImpl: async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  });
  assert.deepEqual(result, { ok: true });
});

test("requestJson retries transient upstream failures", async () => {
  let attempts = 0;
  const result = await requestJson("https://example.test/data", {
    retries: 1,
    baseDelayMs: 0,
    fetchImpl: async () => {
      attempts += 1;
      return attempts === 1
        ? new Response("unavailable", { status: 503 })
        : new Response(JSON.stringify({ recovered: true }), { status: 200 });
    }
  });
  assert.equal(attempts, 2);
  assert.deepEqual(result, { recovered: true });
});

test("requestJson rejects oversized and invalid responses", async () => {
  await assert.rejects(
    requestJson("https://example.test/large", {
      retries: 0,
      maxBytes: 4,
      fetchImpl: async () => new Response("12345", { status: 200 })
    }),
    UpstreamRequestError
  );
  await assert.rejects(
    requestJson("https://example.test/broken", {
      retries: 0,
      fetchImpl: async () => new Response("not-json", { status: 200 })
    }),
    /invalid JSON/
  );
});
