import test from "node:test";
import assert from "node:assert/strict";
import {
  answersMatch,
  correctAnswersForContent,
  deriveLegacyCorrectAnswers,
  gradeAnswer
} from "../server/modules/practice/grading.js";

test("equivalent fractions are accepted without requiring simplification", () => {
  assert.equal(answersMatch("4/64", "1/16"), true);
  assert.equal(answersMatch("40/12", "10/3"), true);
  assert.equal(answersMatch("6/4", "3/2"), true);
});

test("SAT-style truncated and rounded decimal entries are accepted", () => {
  assert.equal(answersMatch("1.166", "7/6"), true);
  assert.equal(answersMatch("1.167", "7/6"), true);
  assert.equal(answersMatch("0.017", "1/60"), true);
});

test("grading distinguishes blank, correct, and incorrect answers", () => {
  const content = { correct_answer: ["27/50"] };
  assert.deepEqual(gradeAnswer(content, ""), { status: "skipped", isCorrect: null });
  assert.deepEqual(gradeAnswer(content, "0.54"), { status: "correct", isCorrect: true });
  assert.deepEqual(gradeAnswer(content, "0.55"), { status: "incorrect", isCorrect: false });
});

test("rationale answers and legacy choice answers are normalized", () => {
  assert.deepEqual(
    correctAnswersForContent({ rationale: "<p>The correct answer is 3/2. One method follows.</p>" }),
    ["3/2"]
  );
  assert.deepEqual(deriveLegacyCorrectAnswers({ rationale: "Choice C is correct because..." }), ["C"]);
});
