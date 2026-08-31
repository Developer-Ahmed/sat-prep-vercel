import test from "node:test";
import assert from "node:assert/strict";
import { buildVocabularyQuestions } from "../server/modules/vocabulary/question-builder.js";

const pool = [
  { id: 1, term: "abate", definition: "to become less intense", family: "abat" },
  { id: 2, term: "wane", definition: "to become less intense", family: "wan" },
  { id: 3, term: "bolster", definition: "to support", family: "bolst" },
  { id: 4, term: "cryptic", definition: "difficult to understand", family: "crypt" },
  { id: 5, term: "lucid", definition: "clear and understandable", family: "luc" }
];

test("vocabulary quiz options are unique by displayed definition", () => {
  const [question] = buildVocabularyQuestions({ items: [pool[0]], pool, kind: "word", random: () => 0 });
  assert.equal(question.options.length, 4);
  assert.equal(new Set(question.options.map((value) => value.toLowerCase())).size, 4);
  assert.equal(question.answer, pool[0].definition);
  assert.equal(Object.keys(question.optionDetails).length, 4);
});

test("root quizzes alternate direction without mutating source rows", () => {
  const items = [pool[2], pool[3]];
  const questions = buildVocabularyQuestions({ items, pool, kind: "root", random: () => 0.5 });
  assert.match(questions[0].prompt, /meaning best matches/);
  assert.equal(questions[0].answer, pool[2].definition);
  assert.equal(questions[1].prompt, "Which root matches this meaning?");
  assert.equal(questions[1].answer, pool[3].term);
  assert.deepEqual(items, [pool[2], pool[3]]);
});
