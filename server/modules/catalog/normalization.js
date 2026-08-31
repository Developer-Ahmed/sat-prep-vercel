import { deriveLegacyCorrectAnswers } from "../practice/grading.js";

export function canonicalQuestionId(question) {
  return String(question?.external_id || question?.ibn || question?.questionId || question?.question_id || "").trim();
}

export function normalizeCollegeBoardDigitalQuestion(question = {}) {
  const answerOptions = Array.isArray(question.answerOptions) && question.answerOptions.length
    ? Object.fromEntries(
        question.answerOptions.slice(0, 10).map((option, index) => [
          String.fromCharCode(65 + index),
          option?.content || option?.body || String(option || "")
        ])
      )
    : undefined;
  return {
    answerOptions,
    correct_answer: Array.isArray(question.correct_answer) ? question.correct_answer : [],
    rationale: question.rationale || "",
    stem: question.stem || "",
    stimulus: question.stimulus || "",
    type: question.type || "",
    externalid: question.externalid || ""
  };
}

export function normalizeCollegeBoardLegacyQuestion(question = {}) {
  const choices = question?.answer?.choices || {};
  const answerOptions = Object.fromEntries(
    Object.entries(choices).slice(0, 10).map(([letter, choice]) => [letter.toUpperCase(), choice?.body || ""])
  );
  return {
    answerOptions: Object.keys(answerOptions).length ? answerOptions : undefined,
    correct_answer: deriveLegacyCorrectAnswers(question?.answer),
    rationale: question?.answer?.rationale || "",
    stem: question?.prompt || "",
    stimulus: question?.body || "",
    type: question?.answer?.style || "",
    ibn: question?.item_id || ""
  };
}
