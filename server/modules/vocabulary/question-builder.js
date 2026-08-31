import { shuffled } from "../../shared/random.js";

function clean(value) {
  return String(value || "").trim();
}

function uniqueDistractors(item, pool, optionValue, random) {
  const seen = new Set([clean(optionValue(item)).toLocaleLowerCase()]);
  const distractors = [];
  for (const candidate of shuffled(pool.filter((row) => row.id !== item.id), random)) {
    const value = clean(optionValue(candidate));
    const key = value.toLocaleLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    distractors.push(candidate);
    if (distractors.length === 3) break;
  }
  return distractors;
}

export function buildVocabularyQuestions({ items, pool, kind = "word", random = Math.random }) {
  return items.map((item, index) => {
    const rootToMeaning = kind === "root" && index % 2 === 0;
    const answerWithDefinition = kind === "word" || rootToMeaning;
    const optionValue = answerWithDefinition ? (row) => row.definition : (row) => row.term;
    const candidates = [item, ...uniqueDistractors(item, pool, optionValue, random)];
    const options = shuffled(candidates, random).map(optionValue);
    return {
      id: item.id,
      prompt: kind === "word"
        ? "Which definition best matches this word?"
        : rootToMeaning
          ? `Which meaning best matches the root “${item.term}”?`
          : "Which root matches this meaning?",
      clue: kind === "word" ? item.term : rootToMeaning ? item.family : item.definition,
      answer: optionValue(item),
      options,
      optionDetails: Object.fromEntries(candidates.map((candidate) => [optionValue(candidate), candidate])),
      item
    };
  });
}
