import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const seed = await readFile(new URL("../scripts/seed-original-question-bank.js", import.meta.url), "utf8");
const reset = await readFile(new URL("../scripts/reset-preproduction.js", import.meta.url), "utf8");

test("original catalog seeding is an owner-only atomic bulk release", () => {
  assert.match(seed, /process\.env\.DATABASE_ADMIN_URL/);
  assert.match(seed, /BEGIN/);
  assert.match(seed, /pg_advisory_xact_lock/);
  assert.match(seed, /COMMIT/);
  assert.match(seed, /ROLLBACK/);
  assert.ok((seed.match(/jsonb_to_recordset/g) || []).length >= 4);
  assert.doesNotMatch(seed, /for \(const question of ORIGINAL_QUESTION_BANK\) \{\s+const content/);
});

test("preproduction reset restores both reference datasets", () => {
  assert.match(reset, /import\("\.\/seed-reference-data\.js"\)/);
  assert.match(reset, /import\("\.\/seed-original-question-bank\.js"\)/);
});
