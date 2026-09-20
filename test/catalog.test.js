import test from "node:test";
import assert from "node:assert/strict";
import {
  ORIGINAL_QUESTION_BANK,
  ORIGINAL_QUESTION_BANK_VERSION
} from "../server/modules/catalog/original-question-bank.js";

test("the original catalog has stable unique IDs and independently authored provenance", () => {
  assert.match(ORIGINAL_QUESTION_BANK_VERSION, /^\d{4}\.\d{2}\.\d+$/);
  assert.equal(new Set(ORIGINAL_QUESTION_BANK.map((question) => question.rowId)).size, ORIGINAL_QUESTION_BANK.length);
  for (const question of ORIGINAL_QUESTION_BANK) {
    assert.match(question.rowId, /^(?:math|english):p16-[a-z0-9-]+$/);
    assert.equal(question.source, "peak1600");
    assert.equal(question.rawJson.independentlyAuthored, true);
    assert.ok(question.content.stem);
    assert.ok(question.content.rationale);
    assert.ok(question.content.correct_answer.length);
  }
});

test("the original bank supports balanced full sections for both subjects", () => {
  const counts = Object.fromEntries(
    [...new Set(ORIGINAL_QUESTION_BANK.map((question) => question.domainDesc))]
      .map((domain) => [domain, ORIGINAL_QUESTION_BANK.filter((question) => question.domainDesc === domain).length])
  );
  assert.ok(counts.Algebra >= 16);
  assert.ok(counts["Advanced Math"] >= 16);
  assert.ok(counts["Problem-Solving and Data Analysis"] >= 8);
  assert.ok(counts["Geometry and Trigonometry"] >= 8);
  assert.ok(counts["Craft and Structure"] >= 16);
  assert.ok(counts["Information and Ideas"] >= 14);
  assert.ok(counts["Standard English Conventions"] >= 16);
  assert.ok(counts["Expression of Ideas"] >= 12);
});

test("the original bank has no duplicate complete prompts and valid choice keys", () => {
  const promptKeys = ORIGINAL_QUESTION_BANK.map((question) => JSON.stringify([
    question.subject,
    question.content.stimulus,
    question.content.stem,
    question.content.answerOptions
      ? Object.values(question.content.answerOptions).sort()
      : null
  ]));
  assert.equal(new Set(promptKeys).size, promptKeys.length);
  for (const question of ORIGINAL_QUESTION_BANK) {
    if (!question.content.answerOptions) continue;
    const keys = Object.keys(question.content.answerOptions);
    assert.equal(keys.length, 4);
    assert.ok(question.content.correct_answer.every((answer) => keys.includes(answer)));
  }
});

test("the original bank contains no former upstream attribution or identifiers", () => {
  const serialized = JSON.stringify(ORIGINAL_QUESTION_BANK).toLowerCase();
  for (const forbidden of ["collegeboard", "college board", "bluebook", "mysatprep", "qbank-api"]) {
    assert.doesNotMatch(serialized, new RegExp(forbidden));
  }
});
