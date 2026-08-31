import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const reset = await readFile(new URL("../scripts/reset-preproduction.js", import.meta.url), "utf8");
const migrationsUrl = new URL("../migrations/", import.meta.url);
const migrationFiles = (await readdir(migrationsUrl)).filter((name) => name.endsWith(".sql"));
const migrations = await Promise.all(
  migrationFiles.map((name) => readFile(new URL(name, migrationsUrl), "utf8"))
);

test("preproduction reset is explicitly guarded and cannot drop database infrastructure", () => {
  assert.match(reset, /CONFIRM_RESET_PREPRODUCTION/);
  assert.match(reset, /confirmation !== "DELETE_ALL_DATA"/);
  assert.doesNotMatch(reset, /DROP\s+(?:DATABASE|SCHEMA|ROLE|USER|OWNED)\b/i);
});

test("preproduction reset covers every table created by migrations", () => {
  const createdTables = new Set(
    migrations.flatMap((source) =>
      [...source.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+([a-z_]+)/gi)].map((match) => match[1])
    )
  );

  for (const table of createdTables) {
    assert.match(reset, new RegExp(`"${table}"`), `${table} must be included in the reset list`);
  }
});
