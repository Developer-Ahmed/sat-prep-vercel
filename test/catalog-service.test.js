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

test("cached question details use one database round trip", async () => {
  const statements = [];
  const db = {
    prepare(sql) {
      statements.push(sql);
      return {
        async get(...args) {
          assert.deepEqual(args, ["user_123", "math:b47419f4"]);
          return {
            row_id: "math:b47419f4",
            source: "collegeboard",
            ibn: "",
            question_id: "b47419f4",
            cached_data_json: JSON.stringify({
              stem: "Which answer is correct?",
              stimulus: "",
              answerOptions: { A: "One", B: "Two" },
              correct_answer: ["B"]
            })
          };
        }
      };
    }
  };
  const service = createCatalogService({
    db,
    currentUserId: () => "user_123",
    collegeBoard: {
      async loadQuestionContent() {
        throw new Error("cached content should not call College Board");
      }
    }
  });

  const detail = await service.getQuestionDetail("math:b47419f4");

  assert.equal(statements.length, 1);
  assert.match(statements[0], /LEFT JOIN question_content/);
  assert.equal(detail.question.cached_data_json, undefined);
  assert.equal(detail.content.stem, "Which answer is correct?");
  assert.deepEqual(detail.content.correct_answer, ["B"]);
});

test("submission content for a module is loaded in one batch", async () => {
  const statements = [];
  const cached = (stem, answer) => ({
    stem,
    stimulus: "",
    answerOptions: { A: "One", B: "Two" },
    correct_answer: [answer]
  });
  const db = {
    prepare(sql) {
      statements.push(sql);
      return {
        async all(...args) {
          assert.deepEqual(args, ["math:q1", "math:q2"]);
          return [
            { question_row_id: "math:q1", data_json: cached("First", "A") },
            { question_row_id: "math:q2", data_json: cached("Second", "B") }
          ];
        }
      };
    }
  };
  const service = createCatalogService({
    db,
    currentUserId: () => "user_123",
    collegeBoard: {
      async loadQuestionContent() {
        throw new Error("cached content should not call College Board");
      }
    }
  });

  const contents = await service.getQuestionContents([
    { row_id: "math:q1", source: "collegeboard", ibn: "" },
    { row_id: "math:q2", source: "collegeboard", ibn: "" }
  ]);

  assert.equal(statements.length, 1);
  assert.equal(contents.get("math:q1").stem, "First");
  assert.equal(contents.get("math:q2").stem, "Second");
});

test("module-prefetched content skips an additional catalog query", async () => {
  const cached = {
    stem: "Already loaded",
    stimulus: "",
    answerOptions: { A: "One", B: "Two" },
    correct_answer: ["A"]
  };
  const service = createCatalogService({
    db: {
      prepare() {
        throw new Error("prefetched content must not query the catalog again");
      }
    },
    currentUserId: () => "user_123",
    collegeBoard: {
      async loadQuestionContent() {
        throw new Error("prefetched content must not call College Board");
      }
    }
  });

  const contents = await service.getQuestionContents([{
    row_id: "math:q1",
    source: "collegeboard",
    ibn: "",
    cached_data_json: cached
  }]);

  assert.equal(contents.get("math:q1").stem, "Already loaded");
});
