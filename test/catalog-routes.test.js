import test from "node:test";
import assert from "node:assert/strict";
import { createCatalogRoutes } from "../server/modules/catalog/routes.js";

function harness(question = undefined) {
  const responses = [];
  let queries = 0;
  const handle = createCatalogRoutes({
    service: {
      async getQuestionDetail(rowId) {
        queries += 1;
        if (question === null) return null;
        return question || { question: { row_id: rowId }, content: { stem: "Original question" } };
      }
    },
    json(_res, status, body) { responses.push({ status, body }); }
  });
  return { handle, responses, queries: () => queries };
}

test("former catalog mutation routes are not exposed", async () => {
  const state = harness();
  for (const path of ["/api/import", "/api/import-new", "/api/cache-all", "/api/cache-status"]) {
    assert.equal(await state.handle({ method: "POST" }, {}, new URL(`https://peak.example${path}`)), false);
  }
  assert.equal(state.queries(), 0);
});

test("question routes reject malformed IDs before database access", async () => {
  const state = harness();
  await assert.rejects(
    () => state.handle({ method: "GET" }, {}, new URL("https://peak.example/api/questions/%2e%2e%2fsecret")),
    { code: "INVALID_QUESTION_ID" }
  );
  assert.equal(state.queries(), 0);
});

test("question routes return original catalog content", async () => {
  const state = harness();
  assert.equal(
    await state.handle({ method: "GET" }, {}, new URL("https://peak.example/api/questions/math%3Ap16-m-alg-0001")),
    true
  );
  assert.equal(state.responses[0].status, 200);
  assert.equal(state.responses[0].body.data.question.row_id, "math:p16-m-alg-0001");
});
