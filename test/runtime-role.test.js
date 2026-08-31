import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const grants = await readFile(new URL("../scripts/grant-runtime-role.sql", import.meta.url), "utf8");
const reset = await readFile(new URL("../scripts/reset-preproduction.js", import.meta.url), "utf8");

test("runtime database role is least-privileged and has bounded query waits", () => {
  assert.doesNotMatch(grants, /ALTER ROLE sat_app\s+NOSUPERUSER/);
  assert.match(grants, /runtime_role\.rolsuper/);
  assert.match(grants, /runtime_role\.rolcreatedb/);
  assert.match(grants, /runtime_role\.rolcreaterole/);
  assert.match(grants, /runtime_role\.rolinherit/);
  assert.match(grants, /runtime_role\.rolreplication/);
  assert.match(grants, /runtime_role\.rolbypassrls/);
  assert.match(grants, /pg_has_role\('sat_app', elevated\.oid, 'MEMBER'\)/);
  assert.match(grants, /statement_timeout = '30s'/);
  assert.match(grants, /lock_timeout = '5s'/);
  assert.match(grants, /idle_in_transaction_session_timeout = '30s'/);
  assert.match(grants, /REVOKE ALL PRIVILEGES ON ALL TABLES/);
  assert.doesNotMatch(grants, /GRANT ALL/);
});

test("preproduction reset delegates runtime grants without splitting procedural SQL", () => {
  assert.match(reset, /import\("\.\/grant-runtime\.js"\)/);
  assert.doesNotMatch(reset, /grants\.split\(";"\)/);
});
