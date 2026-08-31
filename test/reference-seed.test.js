import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../scripts/seed-reference-data.js", import.meta.url), "utf8");

test("reference seeding updates corrected canonical and set-specific wording", () => {
  assert.match(source, /definition = excluded\.definition/);
  assert.match(source, /example = excluded\.example/);
  assert.match(source, /ON CONFLICT\(set_id, item_id\) DO UPDATE SET/);
  assert.match(source, /display_definition = excluded\.display_definition/);
});
