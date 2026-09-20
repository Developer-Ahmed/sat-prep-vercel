import test from "node:test";
import assert from "node:assert/strict";
import { createCatalogService } from "../server/modules/catalog/service.js";

function cached(stem, answer) {
  return {
    stem,
    stimulus: "",
    answerOptions: { A: "One", B: "Two", C: "Three", D: "Four" },
    correct_answer: [answer],
    rationale: "Original explanation"
  };
}

test("cached original question details use one database round trip", async () => {
  const statements = [];
  const db = {
    prepare(sql) {
      statements.push(sql);
      return {
        async get(...args) {
          assert.deepEqual(args, ["user_123", "math:p16-m-alg-0001"]);
          return {
            row_id: "math:p16-m-alg-0001",
            source: "peak1600",
            question_id: "P16-M-ALG-0001",
            cached_data_json: JSON.stringify(cached("Which answer is correct?", "B"))
          };
        }
      };
    }
  };
  const service = createCatalogService({ db, currentUserId: () => "user_123" });
  const detail = await service.getQuestionDetail("math:p16-m-alg-0001");

  assert.equal(statements.length, 1);
  assert.match(statements[0], /q\.source = 'peak1600'/);
  assert.equal(detail.question.cached_data_json, undefined);
  assert.equal(detail.content.stem, "Which answer is correct?");
  assert.deepEqual(detail.content.correct_answer, ["B"]);
});

test("submission content for a module is loaded in one batch", async () => {
  const statements = [];
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
  const service = createCatalogService({ db, currentUserId: () => "user_123" });
  const contents = await service.getQuestionContents([
    { row_id: "math:q1", source: "peak1600" },
    { row_id: "math:q2", source: "peak1600" }
  ]);

  assert.equal(statements.length, 1);
  assert.equal(contents.get("math:q1").stem, "First");
  assert.equal(contents.get("math:q2").stem, "Second");
});

test("missing original content fails closed without an upstream request", async () => {
  const service = createCatalogService({
    db: { prepare: () => ({ all: async () => [] }) },
    currentUserId: () => "user_123"
  });
  await assert.rejects(
    () => service.getQuestionContents([{ row_id: "math:p16-m-alg-0001" }]),
    { code: "QUESTION_CONTENT_UNAVAILABLE", statusCode: 503 }
  );
});

test("module-prefetched content skips an additional catalog query", async () => {
  const service = createCatalogService({
    db: { prepare() { throw new Error("prefetched content must not query again"); } },
    currentUserId: () => "user_123"
  });
  const contents = await service.getQuestionContents([{
    row_id: "math:q1",
    source: "peak1600",
    cached_data_json: cached("Already loaded", "A")
  }]);
  assert.equal(contents.get("math:q1").stem, "Already loaded");
});
