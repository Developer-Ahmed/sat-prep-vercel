import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { z } from "zod";
import { errorPayload, readBody, readJson } from "../server/platform/http.js";

function request(body, contentType = "application/json") {
  const stream = Readable.from(body == null ? [] : [body]);
  stream.headers = { "content-type": contentType };
  return stream;
}

test("JSON boundaries enforce content type and schema", async () => {
  const schema = z.object({ count: z.number().int().min(1).max(98) }).strict();
  assert.deepEqual(await readJson(request('{"count":22}'), schema), { count: 22 });
  await assert.rejects(() => readJson(request('{"count":0}'), schema), { code: "INVALID_REQUEST" });
  await assert.rejects(() => readJson(request('{"count":22}', "text/plain"), schema), {
    code: "UNSUPPORTED_MEDIA_TYPE"
  });
  await assert.rejects(() => readJson(request("{"), schema), { code: "INVALID_JSON" });
});

test("request body limits count bytes, including multibyte input", async () => {
  await assert.rejects(() => readBody(request("éé"), { maxBytes: 3 }), { code: "REQUEST_TOO_LARGE" });
});

test("server errors do not disclose internal messages", () => {
  const response = errorPayload(new Error("DATABASE_URL contains a secret"), "request_test");
  assert.equal(response.statusCode, 500);
  assert.equal(response.body.error, "The server could not complete that request.");
  assert.equal(response.body.code, "INTERNAL_ERROR");
  assert.equal(response.body.requestId, "request_test");
});
