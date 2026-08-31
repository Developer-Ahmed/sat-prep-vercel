import { requestJson } from "../../external-json.js";
import { subjectConfig } from "../../subjects.js";
import {
  canonicalQuestionId,
  normalizeCollegeBoardDigitalQuestion,
  normalizeCollegeBoardLegacyQuestion
} from "./normalization.js";

const BASE_URL = "https://qbank-api.collegeboard.org/msreportingquestionbank-prod/questionbank";
const LEGACY_BASE_URL = "https://saic.collegeboard.org/disclosed";

export function createCollegeBoardClient({ request = requestJson } = {}) {
  const postJson = (url, body) => request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body
  });
  return {
    async loadQuestionContent(question) {
      if (question.external_id) {
        const payload = await postJson(`${BASE_URL}/digital/get-question`, { external_id: question.external_id });
        return normalizeCollegeBoardDigitalQuestion(payload);
      }
      if (!question.ibn) throw new Error("Question is missing a College Board content identifier.");
      const payload = await request(`${LEGACY_BASE_URL}/${encodeURIComponent(question.ibn)}.json`);
      if (!Array.isArray(payload) || !payload[0]) throw new Error("College Board legacy content was not usable.");
      return normalizeCollegeBoardLegacyQuestion(payload[0]);
    },

    async loadImportData(subject = "math") {
      const config = subjectConfig(subject);
      const [questionResponse, lookupResponse] = await Promise.all([
        postJson(`${BASE_URL}/digital/get-questions`, {
          asmtEventId: 99,
          test: config.test,
          domain: config.domains
        }),
        request(`${BASE_URL}/lookup`)
      ]);
      if (!Array.isArray(questionResponse)) {
        throw new Error("College Board question list response was not usable.");
      }
      const seen = new Set();
      const questions = [];
      for (const question of questionResponse) {
        const canonical = canonicalQuestionId(question);
        if (!canonical || seen.has(canonical)) continue;
        seen.add(canonical);
        questions.push({ ...question, source: "collegeboard", rowIdBase: canonical });
      }
      return {
        source: "collegeboard",
        questions,
        live: new Set(lookupResponse?.[config.liveItemsKey] || [])
      };
    }
  };
}
