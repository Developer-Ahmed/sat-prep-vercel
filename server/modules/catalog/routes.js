import { HttpError, parseInput, readJson } from "../../platform/http.js";
import { catalogImportSchema, catalogScopeFromUrl, catalogScopeSchema } from "./contracts.js";

function decodedQuestionId(value) {
  let decoded;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new HttpError(400, "INVALID_QUESTION_ID", "Question ID is invalid.");
  }
  if (!/^(?:math|english):[A-Za-z0-9_-]{1,160}$/.test(decoded)) {
    throw new HttpError(400, "INVALID_QUESTION_ID", "Question ID is invalid.");
  }
  return decoded;
}

export function createCatalogRoutes({ service, json, requireAdmin }) {
  return async function handleCatalogRoute(req, res, url) {
    const scope = () => parseInput(catalogScopeSchema, catalogScopeFromUrl(url));

    if (url.pathname === "/api/cache-status" && req.method === "GET") {
      const { subject, pool } = scope();
      json(res, 200, { success: true, data: await service.publicCacheJob(subject, pool) });
      return true;
    }
    if (url.pathname === "/api/cache-all" && req.method === "POST") {
      requireAdmin();
      const { subject, pool } = await readJson(req, catalogScopeSchema);
      json(res, 200, { success: true, data: await service.startCacheAllQuestions(subject, pool) });
      return true;
    }
    if (url.pathname === "/api/import" && req.method === "POST") {
      requireAdmin();
      const body = await readJson(req, catalogImportSchema);
      json(res, 200, { success: true, data: await service.importQuestions(body.source, body.subject, body.pool) });
      return true;
    }
    if (url.pathname === "/api/import-new" && req.method === "POST") {
      requireAdmin();
      const body = await readJson(req, catalogImportSchema);
      json(res, 200, { success: true, data: await service.importNewQuestions(body.subject) });
      return true;
    }
    const questionMatch = url.pathname.match(/^\/api\/questions\/(.+)$/);
    if (questionMatch && req.method === "GET") {
      const rowId = decodedQuestionId(questionMatch[1]);
      const question = await service.getQuestion(rowId);
      if (!question) throw new HttpError(404, "QUESTION_NOT_FOUND", "Question not found.");
      const content = await service.getQuestionContent(question);
      json(res, 200, { success: true, data: { question, content } });
      return true;
    }
    return false;
  };
}
