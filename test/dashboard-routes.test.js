import test from "node:test";
import assert from "node:assert/strict";
import { createDashboardRoutes } from "../server/modules/dashboard/routes.js";

test("dashboard bootstrap starts independent feature reads together", async () => {
  const calls = [];
  const completions = [];
  const pending = (name, value) => new Promise((resolve) => {
    calls.push(name);
    completions.push(() => resolve(value));
  });
  const responses = [];
  const handle = createDashboardRoutes({
    practice: {
      getStatus: (subject, pool) => pending("status", { subject, pool }),
      listModules: () => pending("modules", [{ id: 1 }])
    },
    json(_res, status, body) {
      responses.push({ status, body });
    }
  });

  const result = handle(
    { method: "GET" },
    {},
    new URL("https://sat.example/api/dashboard?subject=english&pool=main")
  );
  assert.deepEqual(calls, ["status", "modules"]);
  completions.forEach((complete) => complete());

  assert.equal(await result, true);
  assert.deepEqual(responses[0], {
    status: 200,
    body: {
      success: true,
      data: {
        status: { subject: "english", pool: "main" },
        modules: [{ id: 1 }]
      }
    }
  });
});

test("dashboard bootstrap ignores unrelated routes", async () => {
  const handle = createDashboardRoutes({ practice: {}, json() {} });
  assert.equal(await handle({ method: "GET" }, {}, new URL("https://sat.example/api/status")), false);
});
