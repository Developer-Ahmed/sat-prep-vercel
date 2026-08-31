import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createUserRoutes } from "../server/modules/users/routes.js";

function request(body, headers = {}) {
  const stream = Readable.from([body]);
  stream.method = "POST";
  stream.headers = { "content-type": "application/json", ...headers };
  return stream;
}

test("verified Clerk events pass only a receipt and opaque user ID to the service", async () => {
  let received;
  let response;
  const routes = createUserRoutes({
    service: { async processClerkWebhook(value) { received = value; return { duplicate: false }; } },
    json(_res, status, body) { response = { status, body }; },
    async verifyWebhook() { return { type: "user.created", data: { id: "user_12345678", email_addresses: ["private@example.com"] } }; }
  });
  const req = request('{"type":"user.created"}', { "svix-id": "msg_12345678" });
  assert.equal(await routes.handlePublicUserRoute(req, {}, new URL("http://local/api/webhooks/clerk")), true);
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(received).sort(), ["eventId", "eventType", "payloadSha256", "userId"]);
  assert.equal(received.userId, "user_12345678");
  assert.equal(received.payloadSha256.length, 64);
});

test("invalid webhook signatures fail closed before database processing", async () => {
  let processed = false;
  let response;
  const routes = createUserRoutes({
    service: { async processClerkWebhook() { processed = true; } },
    json(_res, status, body) { response = { status, body }; },
    async verifyWebhook() { throw new Error("bad signature"); }
  });
  const req = request("{}", { "svix-id": "msg_12345678" });
  await routes.handlePublicUserRoute(req, {}, new URL("http://local/api/webhooks/clerk"));
  assert.equal(response.status, 400);
  assert.equal(processed, false);
});

test("reset progress accepts only a strict SAT scope", async () => {
  let response;
  const routes = createUserRoutes({
    service: { async resetProgress(subject, pool) { return { subject, pool }; } },
    json(_res, status, body) { response = { status, body }; }
  });
  const req = request('{"subject":"english","pool":"main"}');
  assert.equal(await routes.handleUserRoute(req, {}, new URL("http://local/api/reset-progress")), true);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.data, { subject: "english", pool: "main" });
});
