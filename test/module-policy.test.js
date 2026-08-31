import test from "node:test";
import assert from "node:assert/strict";
import {
  chooseFillableQuota,
  orderRealisticRows,
  realisticQuotaOptions
} from "../server/modules/practice/module-policy.js";
import { shuffled } from "../server/shared/random.js";

test("realistic quota selection only chooses a fillable 22-question distribution", () => {
  const counts = {
    "Algebra": 8,
    "Advanced Math": 7,
    "Problem-Solving and Data Analysis": 4,
    "Geometry and Trigonometry": 3
  };
  const quota = chooseFillableQuota(counts, "math", () => 0.99);
  assert.ok(quota);
  assert.equal(Object.values(quota).reduce((sum, count) => sum + count, 0), 22);
  assert.ok(Object.entries(quota).every(([domain, needed]) => counts[domain] >= needed));
  assert.equal(chooseFillableQuota({}, "math"), null);
  const firstRead = realisticQuotaOptions("english");
  firstRead[0]["Information and Ideas"] = 999;
  assert.notEqual(realisticQuotaOptions("english")[0]["Information and Ideas"], 999);
});

test("English realistic ordering follows SAT domain and skill progression", () => {
  const rows = [
    { id: "notes", domain_desc: "Expression of Ideas", skill_desc: "Rhetorical Synthesis" },
    { id: "grammar", domain_desc: "Standard English Conventions", skill_desc: "Boundaries" },
    { id: "reading", domain_desc: "Information and Ideas", skill_desc: "Inferences" },
    { id: "transition", domain_desc: "Expression of Ideas", skill_desc: "Transitions" },
    { id: "craft", domain_desc: "Craft and Structure", skill_desc: "Words in Context" }
  ];
  assert.deepEqual(orderRealisticRows(rows, "english", () => 0.5).map((row) => row.id), [
    "craft", "reading", "grammar", "transition", "notes"
  ]);
});

test("Fisher-Yates shuffle preserves each question exactly once", () => {
  const input = [1, 2, 3, 4, 5];
  const output = shuffled(input, () => 0);
  assert.deepEqual([...output].sort(), input);
  assert.notDeepEqual(output, input);
  assert.deepEqual(input, [1, 2, 3, 4, 5]);
});
