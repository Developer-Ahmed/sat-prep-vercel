import test from "node:test";
import assert from "node:assert/strict";
import { createPracticeService } from "../server/modules/practice/service.js";

test("status uses one database round trip and normalizes its aggregate result", async () => {
  const statements = [];
  const parameters = [];
  const db = {
    prepare(sql) {
      statements.push(sql);
      return {
        async get(...args) {
          parameters.push(args);
          return {
            total: "10",
            available: "8",
            unanswered: "5",
            answered: "3",
            correct: "2",
            incorrect: "1",
            flagged: "1",
            imported_at: "2026-09-05T00:00:00.000Z",
            active_source: "peak1600",
            performance_rows: JSON.stringify([
              { domain: "Algebra", skill: "Linear equations", total: 8, correct: 2, incorrect: 1, answered: 3 }
            ])
          };
        }
      };
    }
  };
  const catalog = {
    activeSourceFor() {},
    async getQuestionContents() { return new Map(); },
    isAnsweredStatus() {},
    normalizePool: (value) => value === "new" ? "new" : "main",
  };
  const service = createPracticeService({
    db,
    currentUserId: () => "user_123",
    catalog
  });

  const status = await service.getStatus("math", "main");

  assert.equal(statements.length, 1);
  assert.match(statements[0], /WITH scoped AS MATERIALIZED/);
  assert.deepEqual(parameters[0], ["user_123", "math", "main", "activeSource:math:main"]);
  assert.deepEqual(status, {
    total: 10,
    available: 8,
    unanswered: 5,
    answered: 3,
    correct: 2,
    incorrect: 1,
    flagged: 1,
    subject: "math",
    pool: "main",
    activeSource: "peak1600",
    performanceByDomain: [{
      domain: "Algebra",
      correct: 2,
      incorrect: 1,
      answered: 3,
      total: 8,
      skills: [{ skill: "Linear equations", total: 8, correct: 2, incorrect: 1, answered: 3 }]
    }]
  });
});

test("opening a module starts independent detail reads together", async () => {
  let releaseDetails;
  const detailGate = new Promise((resolve) => { releaseDetails = resolve; });
  const started = [];
  const db = {
    prepare(sql) {
      if (/SELECT\s+m\.id,[\s\S]*WHERE m\.id =/m.test(sql)) {
        return {
          async get() {
            return {
              id: 42,
              session_id: 9,
              section_id: 9,
              section_order: 1,
              subject: "math",
              pool: "main",
              kind: "practice"
            };
          }
        };
      }
      if (sql.includes("FROM module_questions")) {
        return { async all() { started.push("questions"); await detailGate; return []; } };
      }
      if (sql.includes("FROM response_time_segments")) {
        return { async all() { started.push("timing"); await detailGate; return []; } };
      }
      if (sql.includes("FROM test_modules")) {
        return { async get() { started.push("next-module"); await detailGate; return undefined; } };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
  const catalog = {
    activeSourceFor() {},
    async getQuestionContents() { return new Map(); },
    isAnsweredStatus() {},
    normalizePool: (value) => value
  };
  const service = createPracticeService({
    db,
    currentUserId: () => "user_123",
    catalog,
    isAdmin: () => false
  });

  const modulePromise = service.getModule(42);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started.sort(), ["next-module", "questions", "timing"]);
  releaseDetails();
  const module = await modulePromise;
  assert.deepEqual(module.questions, []);
});

test("flagging performs one atomic ownership-checked database statement", async () => {
  const statements = [];
  const db = {
    prepare(sql) {
      statements.push(sql);
      return {
        async get(...args) {
          assert.deepEqual(args.slice(0, 3), ["math:b47419f4", 42, "user_123"]);
          return { saved: true };
        }
      };
    },
    async transaction() {
      throw new Error("flagging should not open an interactive transaction");
    }
  };
  const catalog = {
    activeSourceFor() {},
    isAnsweredStatus() {},
    normalizePool: (value) => value
  };
  const service = createPracticeService({
    db,
    currentUserId: () => "user_123",
    catalog,
    isAdmin: () => false
  });

  await service.saveFlag(42, "math:b47419f4", true);

  assert.equal(statements.length, 1);
  assert.match(statements[0], /WITH editable_module AS/);
  assert.match(statements[0], /FOR UPDATE OF m/);
  assert.match(statements[0], /question_write AS/);
  assert.doesNotMatch(statements[0], /module_responses/);
  assert.match(statements[0], /progress_write AS/);
});

test("answer saves are atomic and preserve a newer overlapping flag", async () => {
  const statements = [];
  const db = {
    prepare(sql) {
      statements.push(sql);
      return { async get() { return { saved: true }; } };
    },
    async transaction() {
      throw new Error("answer saving should not open an interactive transaction");
    }
  };
  const catalog = {
    activeSourceFor() {},
    isAnsweredStatus() {},
    normalizePool: (value) => value
  };
  const service = createPracticeService({
    db,
    currentUserId: () => "user_123",
    catalog,
    isAdmin: () => false
  });

  await service.saveDraftAnswer(42, "math:b47419f4", "B", false);

  assert.equal(statements.length, 1);
  assert.match(statements[0], /WITH editable_module AS/);
  assert.match(statements[0], /FOR UPDATE OF m/);
  assert.doesNotMatch(statements[0], /flagged\s*=\s*excluded\.flagged/);
});

test("timing saves use one atomic statement", async () => {
  const statements = [];
  const db = {
    prepare(sql) {
      statements.push(sql);
      return { async get() { return { saved: true }; } };
    },
    async transaction() {
      throw new Error("timing should not open an interactive transaction");
    }
  };
  const catalog = {
    activeSourceFor() {},
    getQuestionContents() {},
    isAnsweredStatus() {},
    normalizePool: (value) => value
  };
  const service = createPracticeService({
    db,
    currentUserId: () => "user_123",
    catalog,
    isAdmin: () => false
  });

  await service.saveQuestionTime(42, "math:b47419f4", 75, 2, 30);

  assert.equal(statements.length, 1);
  assert.match(statements[0], /question_write AS/);
  assert.match(statements[0], /segment_write AS/);
});

test("submission finalizes grading and section state in two transactional statements", async () => {
  const transactionStatements = [];
  const content = {
    stem: "Choose A.",
    stimulus: "",
    answerOptions: { A: "Correct", B: "Incorrect" },
    correct_answer: ["A"]
  };
  const db = {
    prepare(sql) {
      if (/SELECT\s+m\.id,[\s\S]*WHERE m\.id =/m.test(sql)) {
        return {
          async get() {
            return {
              id: 42,
              session_id: 9,
              section_id: 9,
              section_order: 1,
              position: 1,
              subject: "math",
              pool: "main",
              kind: "practice",
              submitted_at: null
            };
          }
        };
      }
      if (sql.includes("FROM module_questions")) {
        return {
          async all() {
            return [{
              row_id: "math:q1",
              source: "peak1600",
              answer: "A",
              module_flagged: false,
              position: 1,
              cached_data_json: content
            }];
          }
        };
      }
      if (sql.includes("FROM response_time_segments")) return { async all() { return []; } };
      if (sql.includes("FROM test_modules")) return { async get() { return undefined; } };
      throw new Error(`Unexpected SQL outside transaction: ${sql}`);
    },
    async transaction(callback) {
      return callback({
        prepare(sql) {
          transactionStatements.push(sql);
          if (sql.includes("FOR UPDATE OF m")) {
            return {
              async all() {
                return [{
                  session_id: 9,
                  position: 1,
                  submitted_at: null,
                  row_id: "math:q1",
                  answer: "A",
                  flagged: false
                }];
              }
            };
          }
          return {
            async get() {
              return { submitted: true, next_module_id: null, question_count: 1, progress_count: 1 };
            }
          };
        }
      });
    }
  };
  const catalog = {
    activeSourceFor() {},
    async getQuestionContents(questions) {
      return new Map(questions.map((question) => [question.row_id, content]));
    },
    isAnsweredStatus: (status) => status === "correct" || status === "incorrect",
    normalizePool: (value) => value
  };
  const service = createPracticeService({
    db,
    currentUserId: () => "user_123",
    catalog,
    isAdmin: () => false
  });

  const submitted = await service.submitModule(42);

  assert.equal(transactionStatements.length, 2);
  assert.match(transactionStatements[0], /FOR UPDATE OF m/);
  assert.match(transactionStatements[1], /question_write AS/);
  assert.doesNotMatch(transactionStatements[1], /module_responses/);
  assert.match(transactionStatements[1], /session_write AS/);
  assert.equal(submitted.submitted_at == null, false);
  assert.equal(submitted.questions[0].status, "correct");
  assert.equal(submitted.questions[0].is_correct, true);
});
