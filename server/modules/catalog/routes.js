import { HttpError } from "../../platform/http.js";

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

export function createCatalogRoutes({ service, json }) {
  return async function handleCatalogRoute(req, res, url) {
    const questionMatch = url.pathname.match(/^\/api\/questions\/(.+)$/);
    if (questionMatch && req.method === "GET") {
      const rowId = decodedQuestionId(questionMatch[1]);
      const detail = await service.getQuestionDetail(rowId);
      if (!detail) throw new HttpError(404, "QUESTION_NOT_FOUND", "Question not found.");
      json(res, 200, { success: true, data: detail });
      return true;
    }
    return false;
  };
}
