import test from "node:test";
import assert from "node:assert/strict";
import { scheduleVocabularyReview } from "../server/modules/vocabulary/scheduler.js";

const reviewedAt = new Date("2026-08-28T12:00:00.000Z");

test("again schedules a short relearning interval", () => {
  assert.deepEqual(scheduleVocabularyReview({ previousIntervalDays: 20, rating: "again", reviewedAt }), {
    state: "learning",
    intervalDays: 0,
    dueAt: "2026-08-28T12:10:00.000Z"
  });
});

test("good, hard, and easy ratings grow intervals predictably", () => {
  assert.equal(scheduleVocabularyReview({ previousIntervalDays: 0, rating: "good", reviewedAt }).intervalDays, 1);
  assert.equal(scheduleVocabularyReview({ previousIntervalDays: 10, rating: "hard", reviewedAt }).intervalDays, 12);
  assert.equal(scheduleVocabularyReview({ previousIntervalDays: 10, rating: "easy", reviewedAt }).intervalDays, 30);
  assert.equal(scheduleVocabularyReview({ previousIntervalDays: 10, rating: "easy", reviewedAt }).state, "mastered");
});

test("unknown ratings are rejected by the domain policy", () => {
  assert.throws(() => scheduleVocabularyReview({ rating: "perfect", reviewedAt }), /Unknown/);
});
