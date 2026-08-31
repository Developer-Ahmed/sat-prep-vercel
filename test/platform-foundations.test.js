import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { errorLogFields, redactLogValue, requestIdFor } from "../server/observability.js";
import { resolvePublicPath } from "../server/static-path.js";

test("request IDs accept safe correlation values and replace unsafe values", () => {
  assert.equal(requestIdFor({ headers: { "x-request-id": "request_12345" } }), "request_12345");
  assert.match(requestIdFor({ headers: { "x-request-id": "bad value" } }), /^[0-9a-f-]{36}$/);
});

test("structured logs redact database and authentication secrets at every depth", () => {
  const env = {
    DATABASE_URL: "postgresql://sat_app:database-password@example.test/neondb?sslmode=require",
    CLERK_SECRET_KEY: "sk_test_server_secret_value",
    CLERK_WEBHOOK_SIGNING_SECRET: "whsec_webhook_secret_value"
  };
  const sanitized = redactLogValue({
    message: `Database failed at ${env.DATABASE_URL}`,
    nested: {
      clerk: env.CLERK_SECRET_KEY,
      webhook: env.CLERK_WEBHOOK_SIGNING_SECRET,
      authorization: "Bearer session-token"
    },
    password: "short-value"
  }, env);
  const serialized = JSON.stringify(sanitized);

  assert.doesNotMatch(serialized, /database-password|server_secret|webhook_secret|session-token|short-value/);
  assert.match(serialized, /REDACTED/);
  assert.equal(sanitized.nested.authorization, "[REDACTED]");
  assert.equal(sanitized.password, "[REDACTED]");
});

test("development error fields redact secrets while retaining useful diagnostics", () => {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgresql://sat_app:error-password@example.test/neondb";
  try {
    const fields = errorLogFields(new Error(`Connection failed: ${process.env.DATABASE_URL}`));
    assert.equal(fields.errorName, "Error");
    assert.match(fields.errorMessage, /Connection failed/);
    assert.doesNotMatch(JSON.stringify(fields), /error-password/);
  } finally {
    if (previous == null) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});

test("static paths remain inside the public directory", () => {
  assert.equal(resolvePublicPath("/srv/app/public", "/styles.css"), "/srv/app/public/styles.css");
  assert.equal(resolvePublicPath("/srv/app/public", "/../secrets.txt"), null);
  assert.equal(resolvePublicPath("/srv/app/public", "/../public-evil/file.txt"), null);
});

test("feature route dispatchers are wired inside the HTTP composition root", async () => {
  const source = await readFile(new URL("../server/app.js", import.meta.url), "utf8");
  const routeStart = source.indexOf("async function route(");
  const catalogDispatch = source.indexOf("await handleCatalogRoute(req, res, url)");
  const practiceDispatch = source.indexOf("await handlePracticeRoute(req, res, url)");
  const vocabularyDispatch = source.indexOf("await handleVocabularyRoute(req, res, url)");
  assert.ok(routeStart >= 0);
  assert.ok(catalogDispatch > routeStart);
  assert.ok(practiceDispatch > routeStart);
  assert.ok(vocabularyDispatch > routeStart);
  assert.equal(source.indexOf("await handleCatalogRoute(req, res, url)", catalogDispatch + 1), -1);
  assert.equal(source.indexOf("await handlePracticeRoute(req, res, url)", practiceDispatch + 1), -1);
  assert.equal(source.indexOf("await handleVocabularyRoute(req, res, url)", vocabularyDispatch + 1), -1);
});
