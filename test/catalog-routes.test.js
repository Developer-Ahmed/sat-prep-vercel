import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createCatalogRoutes } from "../server/modules/catalog/routes.js";

function request(method = "GET", body) {
  const req = Readable.from(body == null ? [] : [JSON.stringify(body)]);
  req.method = method;
  req.headers = body == null ? {} : { "content-type": "application/json" };
  return req;
}

function harness(overrides = {}) {
  const responses = [];
  let adminChecks = 0;
  const service = {
    publicCacheJob: async (subject, pool) => ({ subject, pool }),
    startCacheAllQuestions: async (subject, pool) => ({ subject, pool }),
    importQuestions: async (source, subject, pool) => ({ source, subject, pool }),
    importNewQuestions: async (subject) => ({ subject }),
    getQuestionDetail: async (rowId) => overrides.question === null
      ? null
      : { question: overrides.question ?? { row_id: rowId }, content: { stem: "Question" } },
    ...overrides.service
  };
  const handle = createCatalogRoutes({
    service,
    requireAdmin() { adminChecks += 1; },
    json(_res, status, body) { responses.push({ status, body }); }
  });
  return { handle, responses, adminChecks: () => adminChecks };
}

test("catalog import routes require valid bounded contracts", async () => {
  const state = harness();
  const valid = request("POST", { source: "collegeboard", subject: "english", pool: "main" });
  assert.equal(await state.handle(valid, {}, new URL("https://sat.example/api/import")), true);
  assert.equal(state.adminChecks(), 1);
  assert.deepEqual(state.responses[0].body.data, {
    source: "collegeboard",
    subject: "english",
    pool: "main"
  });

  const invalid = request("POST", { source: "other", subject: "math", pool: "main" });
  await assert.rejects(
    () => state.handle(invalid, {}, new URL("https://sat.example/api/import")),
    { code: "INVALID_REQUEST" }
  );
});

test("question routes reject malformed IDs before database access", async () => {
  let queried = false;
  const state = harness({ service: { getQuestion: async () => { queried = true; } } });
  await assert.rejects(
    () => state.handle(request(), {}, new URL("https://sat.example/api/questions/%2e%2e%2fsecret")),
    { code: "INVALID_QUESTION_ID" }
  );
  assert.equal(queried, false);
});

test("question routes return sanitized service content", async () => {
  const state = harness();
  assert.equal(
    await state.handle(request(), {}, new URL("https://sat.example/api/questions/math%3Ab47419f4")),
    true
  );
  assert.equal(state.responses[0].status, 200);
  assert.equal(state.responses[0].body.data.question.row_id, "math:b47419f4");
});
