import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createVocabularyRoutes } from "../server/modules/vocabulary/routes.js";

function request(method = "GET", body) {
  const req = Readable.from(body == null ? [] : [JSON.stringify(body)]);
  req.method = method;
  req.headers = body == null ? {} : { "content-type": "application/json" };
  return req;
}

function harness() {
  const calls = [];
  const responses = [];
  const service = new Proxy({}, {
    get(_target, method) {
      return async (...args) => {
        calls.push({ method, args });
        return { method };
      };
    }
  });
  return {
    calls,
    responses,
    handle: createVocabularyRoutes({
      service,
      json(_res, status, body) { responses.push({ status, body }); }
    })
  };
}

test("vocabulary queries are bounded and normalized", async () => {
  const state = harness();
  assert.equal(await state.handle(
    request(),
    {},
    new URL("https://sat.example/api/vocab/session?kind=word&set=vocab-terms&limit=20")
  ), true);
  assert.deepEqual(state.calls[0], { method: "vocabSession", args: ["word", 20, "vocab-terms"] });

  await assert.rejects(
    () => state.handle(request(), {}, new URL("https://sat.example/api/vocab/items?search=" + "x".repeat(101))),
    { code: "INVALID_REQUEST" }
  );
});

test("vocabulary bootstrap starts set and dashboard reads together", async () => {
  const started = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const responses = [];
  const service = {
    async listVocabSets(kind) {
      started.push(["sets", kind]);
      await gate;
      return [{ id: 1 }];
    },
    async vocabDashboard(kind, set) {
      started.push(["dashboard", kind, set]);
      await gate;
      return { set: { id: 1 } };
    }
  };
  const handle = createVocabularyRoutes({
    service,
    json(_res, status, body) { responses.push({ status, body }); }
  });

  const response = handle(
    request(),
    {},
    new URL("https://sat.example/api/vocab/bootstrap?kind=word&set=vocab-terms")
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, [["sets", "word"], ["dashboard", "word", "vocab-terms"]]);
  release();
  assert.equal(await response, true);
  assert.deepEqual(responses[0], {
    status: 200,
    body: { success: true, data: { sets: [{ id: 1 }], dashboard: { set: { id: 1 } } } }
  });
});

test("custom vocabulary rejects empty and oversized entries", async () => {
  const state = harness();
  await assert.rejects(
    () => state.handle(request("POST", { term: " ", definition: "definition", setId: "1" }), {}, new URL("https://sat.example/api/vocab/words")),
    { code: "INVALID_REQUEST" }
  );
  await assert.rejects(
    () => state.handle(request("POST", { term: "word", definition: "x".repeat(601), setId: "1" }), {}, new URL("https://sat.example/api/vocab/words")),
    { code: "INVALID_REQUEST" }
  );
  assert.equal(state.calls.length, 0);
});

test("reviews require a positive item, known rating, and idempotency key", async () => {
  const state = harness();
  const valid = { itemId: 7, rating: "good", setId: "2", requestId: "review_123456" };
  assert.equal(await state.handle(request("POST", valid), {}, new URL("https://sat.example/api/vocab/review")), true);
  assert.deepEqual(state.calls[0], {
    method: "reviewVocabItem",
    args: [7, "good", "2", "review_123456"]
  });
  await assert.rejects(
    () => state.handle(request("POST", { ...valid, rating: "perfect" }), {}, new URL("https://sat.example/api/vocab/review")),
    { code: "INVALID_REQUEST" }
  );
});
