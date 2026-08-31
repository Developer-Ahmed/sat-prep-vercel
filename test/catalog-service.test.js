import test from "node:test";
import assert from "node:assert/strict";
import { createCatalogService } from "../server/modules/catalog/service.js";

function databaseHarness() {
  const statements = [];
  const db = {
    prepare(sql) {
      return {
        async run(...args) {
          statements.push({ sql, args });
          return { changes: 1 };
        }
      };
    },
    async transaction(callback) {
      return callback(db);
    }
  };
  return { db, statements };
}

test("operator catalog import returns a bounded summary without user-scoped status", async () => {
  const { db, statements } = databaseHarness();
  const service = createCatalogService({
    db,
    currentUserId() {
      throw new Error("user scope must not be used");
    },
    collegeBoard: {
      async loadImportData() {
        return {
          source: "collegeboard",
          questions: [
            { external_id: "available-1", primary_class_cd: "H" },
            { external_id: "bluebook-1", primary_class_cd: "H" }
          ],
          live: new Set(["bluebook-1"])
        };
      }
    }
  });

  const result = await service.importQuestions("collegeboard", "math", "main");

  assert.equal(result.source, "collegeboard");
  assert.equal(result.subject, "math");
  assert.equal(result.pool, "main");
  assert.equal(result.imported, 2);
  assert.equal(result.excludedBluebook, 1);
  assert.match(result.importedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(statements.some(({ sql }) => sql.includes("INSERT INTO questions")));
  assert.ok(statements.some(({ sql }) => sql.includes("INSERT INTO question_source_refs")));
  assert.ok(statements.some(({ sql }) => sql.includes("INSERT INTO question_pool_memberships")));
});
