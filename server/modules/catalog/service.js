import { normalizeContentCorrectAnswers } from "../practice/grading.js";
import { HttpError } from "../../platform/http.js";
import { sanitizeQuestionContent } from "../../platform/question-content.js";
import { normalizeSubject } from "../../subjects.js";

export function createCatalogService({ db, currentUserId }) {
  function jsonValue(value) {
    return typeof value === "string" ? JSON.parse(value) : value;
  }

  function contentIsUsable(content) {
    return Boolean(
      content
      && (content.stem || content.stimulus)
      && Array.isArray(content.correct_answer)
      && content.correct_answer.length
    );
  }

  function normalizePool() {
    return "main";
  }

  async function getSetting(key, fallback = "") {
    return (await db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key))?.value || fallback;
  }

  async function activeSourceFor(subject = "math") {
    return getSetting(`activeSource:${normalizeSubject(subject)}:main`, "");
  }

  function usableCachedContent(dataJson) {
    if (dataJson == null) return null;
    try {
      const content = sanitizeQuestionContent(jsonValue(dataJson));
      return contentIsUsable(content) ? normalizeContentCorrectAnswers(content) : null;
    } catch {
      return null;
    }
  }

  function missingContentError(rowId) {
    return new HttpError(
      503,
      "QUESTION_CONTENT_UNAVAILABLE",
      `Original content is unavailable for question ${rowId}. Reseed the question bank.`
    );
  }

  async function getQuestionContents(questions) {
    if (!questions.length) return new Map();
    const prefetched = questions.every((question) => Object.hasOwn(question, "cached_data_json"));
    let cachedByRowId;
    if (prefetched) {
      cachedByRowId = new Map(questions.map((question) => [question.row_id, question.cached_data_json]));
    } else {
      const placeholders = questions.map(() => "?").join(", ");
      const rows = await db.prepare(`
        SELECT question_row_id, data_json
        FROM question_content
        WHERE question_row_id IN (${placeholders})
      `).all(...questions.map((question) => question.row_id));
      cachedByRowId = new Map(rows.map((row) => [row.question_row_id, row.data_json]));
    }

    return new Map(questions.map((question) => {
      const content = usableCachedContent(cachedByRowId.get(question.row_id));
      if (!content) throw missingContentError(question.row_id);
      return [question.row_id, content];
    }));
  }

  async function getQuestionDetail(rowId) {
    const row = await db.prepare(`
      SELECT
        q.*,
        p.status,
        p.flagged,
        p.selected_answer,
        p.answered_at,
        qc.data_json AS cached_data_json
      FROM question_catalog q
      LEFT JOIN progress p ON p.user_id = ? AND p.row_id = q.row_id
      LEFT JOIN question_content qc ON qc.question_row_id = q.row_id
      WHERE q.row_id = ? AND q.source = 'peak1600' AND q.pool = 'main'
    `).get(currentUserId(), rowId);
    if (!row) return null;
    const { cached_data_json: dataJson, ...question } = row;
    const content = usableCachedContent(dataJson);
    if (!content) throw missingContentError(rowId);
    return { question, content };
  }

  return {
    activeSourceFor,
    getQuestionContents,
    getQuestionDetail,
    isAnsweredStatus: (status) => status === "correct" || status === "incorrect",
    normalizePool
  };
}
