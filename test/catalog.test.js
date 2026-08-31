import test from "node:test";
import assert from "node:assert/strict";
import { createCollegeBoardClient } from "../server/modules/catalog/college-board-client.js";
import {
  canonicalQuestionId,
  normalizeCollegeBoardDigitalQuestion,
  normalizeCollegeBoardLegacyQuestion
} from "../server/modules/catalog/normalization.js";

test("catalog normalization keeps stable IDs and bounded answer options", () => {
  assert.equal(canonicalQuestionId({ external_id: " external-1 ", ibn: "legacy" }), "external-1");
  assert.equal(canonicalQuestionId({ ibn: " legacy-1 " }), "legacy-1");
  const content = normalizeCollegeBoardDigitalQuestion({
    answerOptions: Array.from({ length: 12 }, (_, index) => ({ content: `Option ${index}` })),
    correct_answer: ["A"]
  });
  assert.equal(Object.keys(content.answerOptions).length, 10);
  assert.deepEqual(content.correct_answer, ["A"]);
});

test("legacy catalog normalization derives multiple-choice answers", () => {
  const content = normalizeCollegeBoardLegacyQuestion({
    item_id: "legacy-1",
    prompt: "Prompt",
    answer: {
      choices: { a: { body: "One" }, b: { body: "Two" } },
      rationale: "Choice B is correct."
    }
  });
  assert.deepEqual(content.correct_answer, ["B"]);
  assert.deepEqual(content.answerOptions, { A: "One", B: "Two" });
});

test("College Board client deduplicates import rows and preserves Bluebook exclusions", async () => {
  const calls = [];
  const client = createCollegeBoardClient({
    async request(url, options) {
      calls.push({ url, options });
      if (url.endsWith("/lookup")) return { mathLiveItems: ["live-1"] };
      return [
        { external_id: "new-1", primary_class_cd: "H" },
        { external_id: "new-1", primary_class_cd: "H" },
        { external_id: "live-1", primary_class_cd: "H" }
      ];
    }
  });
  const result = await client.loadImportData("math");
  assert.equal(result.questions.length, 2);
  assert.equal(result.questions[0].source, "collegeboard");
  assert.equal(calls.length, 2);
  assert.deepEqual([...result.live], ["live-1"]);
});

test("College Board client rejects malformed legacy content", async () => {
  const client = createCollegeBoardClient({ request: async () => ({ bad: true }) });
  await assert.rejects(() => client.loadQuestionContent({ ibn: "legacy-1" }), /not usable/);
});
