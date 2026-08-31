const DAY_MS = 86_400_000;
const TEN_MINUTES_MS = 10 * 60 * 1000;
const RATINGS = new Set(["again", "hard", "good", "easy"]);

export function scheduleVocabularyReview({ previousIntervalDays = 0, rating, reviewedAt = new Date() }) {
  if (!RATINGS.has(rating)) throw new Error("Unknown vocabulary review rating.");
  const previous = Math.max(0, Math.floor(Number(previousIntervalDays) || 0));
  const reviewedAtMs = reviewedAt instanceof Date ? reviewedAt.getTime() : new Date(reviewedAt).getTime();
  if (!Number.isFinite(reviewedAtMs)) throw new Error("Review time must be valid.");

  let intervalDays = 0;
  let dueAtMs;
  if (rating === "again") {
    dueAtMs = reviewedAtMs + TEN_MINUTES_MS;
  } else if (rating === "hard") {
    intervalDays = previous <= 1 ? 1 : Math.max(2, Math.round(previous * 1.2));
    dueAtMs = reviewedAtMs + intervalDays * DAY_MS;
  } else if (rating === "easy") {
    intervalDays = previous === 0 ? 4 : Math.max(4, Math.round(previous * 3));
    dueAtMs = reviewedAtMs + intervalDays * DAY_MS;
  } else {
    intervalDays = previous === 0 ? 1 : previous < 3 ? 3 : Math.max(4, Math.round(previous * 2.2));
    dueAtMs = reviewedAtMs + intervalDays * DAY_MS;
  }

  const state = intervalDays >= 21 ? "mastered" : intervalDays > 1 ? "review" : "learning";
  return { state, intervalDays, dueAt: new Date(dueAtMs).toISOString() };
}
