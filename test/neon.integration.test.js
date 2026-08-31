import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Client } from "@neondatabase/serverless";

const connectionString = process.env.TEST_DATABASE_URL;
const integrationTest = connectionString ? test : test.skip;
const root = fileURLToPath(new URL("..", import.meta.url));

function statementsFrom(source) {
  return source
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

integrationTest("fresh schema enforces tenant isolation on real PostgreSQL", { timeout: 30_000 }, async () => {
  const client = new Client({ connectionString });
  const schema = `integration_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA ${schema}`);
    await client.query(`SET search_path TO ${schema}, public`);
    const migrationNames = (await readdir(`${root}/migrations`))
      .filter((name) => name.endsWith(".sql"))
      .sort();
    for (const name of migrationNames) {
      const source = await readFile(`${root}/migrations/${name}`, "utf8");
      for (const statement of statementsFrom(source)) await client.query(statement);
    }
    for (const table of ["app_users", "test_sessions"]) {
      await client.query(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    }

    for (const userId of ["user_alpha", "user_beta"]) {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
      await client.query("INSERT INTO app_users (id) VALUES ($1)", [userId]);
      await client.query(`
        INSERT INTO test_sessions (user_id, subject, pool, kind)
        VALUES ($1, 'math', 'main', 'practice')
      `, [userId]);
      await client.query("COMMIT");
    }

    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', 'user_alpha', true)");
    const visible = await client.query("SELECT user_id FROM test_sessions ORDER BY user_id");
    assert.deepEqual(visible.rows, [{ user_id: "user_alpha" }]);
    await assert.rejects(
      client.query("INSERT INTO app_users (id) VALUES ('user_intruder')"),
      /row-level security/i
    );
    await client.query("ROLLBACK");
  } finally {
    await client.query("RESET search_path").catch(() => undefined);
    await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined);
    await client.end();
  }
});
