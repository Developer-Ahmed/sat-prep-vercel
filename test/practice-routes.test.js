import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createPracticeRoutes } from "../server/modules/practice/routes.js";

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
        if (method === "getModule") return { id: args[0] };
        if (method === "getStatus") return { subject: args[0], pool: args[1] };
        return { method };
      };
    }
  });
  const handle = createPracticeRoutes({
    service,
    json(_res, status, body) { responses.push({ status, body }); }
  });
  return { calls, handle, responses };
}

test("practice creation enforces SAT module limits", async () => {
  const state = harness();
  const body = { mode: "random", count: 22, durationMinutes: 35, includeAnswered: false, subject: "math", pool: "main" };
  assert.equal(await state.handle(request("POST", body), {}, new URL("https://sat.example/api/modules")), true);
  assert.equal(state.responses[0].status, 201);
  assert.deepEqual(state.calls[0], { method: "createModule", args: [body] });

  await assert.rejects(
    () => state.handle(request("POST", { ...body, count: 99 }), {}, new URL("https://sat.example/api/modules")),
    { code: "INVALID_REQUEST" }
  );
});

test("answer and timing routes reject oversized or abusive values", async () => {
  const state = harness();
  const answerUrl = new URL("https://sat.example/api/modules/12/answers");
  await assert.rejects(
    () => state.handle(request("POST", { rowId: "math:b47419f4", answer: "x".repeat(33), flagged: false }), {}, answerUrl),
    { code: "INVALID_REQUEST" }
  );
  const timeUrl = new URL("https://sat.example/api/modules/12/time");
  await assert.rejects(
    () => state.handle(request("POST", {
      rowId: "math:b47419f4",
      timeSpentSeconds: 21_601,
      passIndex: 1,
      passSeconds: 1
    }), {}, timeUrl),
    { code: "INVALID_REQUEST" }
  );
  assert.equal(state.calls.length, 0);
});

test("practice routes validate IDs and scope before service calls", async () => {
  const state = harness();
  await assert.rejects(
    () => state.handle(request(), {}, new URL("https://sat.example/api/status?subject=science&pool=main")),
    { code: "INVALID_REQUEST" }
  );
  await assert.rejects(
    () => state.handle(request(), {}, new URL("https://sat.example/api/modules/0")),
    { code: "INVALID_IDENTIFIER" }
  );
  assert.equal(state.calls.length, 0);
});
