import { HttpError, parseInput, positiveInteger, readJson } from "../../platform/http.js";
import { catalogScopeFromUrl } from "../catalog/contracts.js";
import {
  createModuleSchema,
  createReviewModuleSchema,
  practiceScopeSchema,
  rowIdSchema,
  saveAnswerSchema,
  saveFlagSchema,
  saveTimeSchema
} from "./contracts.js";

function decodedRowId(value) {
  try {
    return parseInput(rowIdSchema, decodeURIComponent(value));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "INVALID_QUESTION_ID", "Question ID is invalid.");
  }
}

export function createPracticeRoutes({ service, json }) {
  return async function handlePracticeRoute(req, res, url) {
    if (url.pathname === "/api/status" && req.method === "GET") {
      const { subject, pool } = parseInput(practiceScopeSchema, catalogScopeFromUrl(url));
      json(res, 200, { success: true, data: await service.getStatus(subject, pool) });
      return true;
    }
    if (url.pathname === "/api/modules" && req.method === "GET") {
      const { subject, pool } = parseInput(practiceScopeSchema, catalogScopeFromUrl(url));
      json(res, 200, { success: true, data: await service.listModules(subject, pool) });
      return true;
    }
    if (url.pathname === "/api/modules" && req.method === "POST") {
      const body = await readJson(req, createModuleSchema);
      json(res, 201, { success: true, data: await service.createModule(body) });
      return true;
    }
    if (url.pathname === "/api/review-modules" && req.method === "POST") {
      const body = await readJson(req, createReviewModuleSchema);
      json(res, 201, { success: true, data: await service.createReviewModule(body) });
      return true;
    }

    const moduleMatch = url.pathname.match(/^\/api\/modules\/(\d+)$/);
    if (moduleMatch && req.method === "GET") {
      const module = await service.getModule(positiveInteger(moduleMatch[1], "Module ID"));
      if (!module) throw new HttpError(404, "MODULE_NOT_FOUND", "Module not found.");
      json(res, 200, { success: true, data: module });
      return true;
    }
    const answerMatch = url.pathname.match(/^\/api\/modules\/(\d+)\/answers$/);
    if (answerMatch && req.method === "POST") {
      const body = await readJson(req, saveAnswerSchema);
      await service.saveDraftAnswer(positiveInteger(answerMatch[1], "Module ID"), body.rowId, body.answer, body.flagged);
      json(res, 200, { success: true });
      return true;
    }
    const flagMatch = url.pathname.match(/^\/api\/modules\/(\d+)\/flag$/);
    if (flagMatch && req.method === "POST") {
      const body = await readJson(req, saveFlagSchema);
      await service.saveFlag(positiveInteger(flagMatch[1], "Module ID"), body.rowId, body.flagged);
      json(res, 200, { success: true });
      return true;
    }
    const timeMatch = url.pathname.match(/^\/api\/modules\/(\d+)\/time$/);
    if (timeMatch && req.method === "POST") {
      const body = await readJson(req, saveTimeSchema);
      await service.saveQuestionTime(
        positiveInteger(timeMatch[1], "Module ID"),
        body.rowId,
        body.timeSpentSeconds,
        body.passIndex,
        body.passSeconds
      );
      json(res, 200, { success: true });
      return true;
    }
    const submitMatch = url.pathname.match(/^\/api\/modules\/(\d+)\/submit$/);
    if (submitMatch && req.method === "POST") {
      json(res, 200, {
        success: true,
        data: await service.submitModule(positiveInteger(submitMatch[1], "Module ID"))
      });
      return true;
    }
    const clearIncorrectMatch = url.pathname.match(/^\/api\/questions\/(.+)\/clear-incorrect$/);
    if (clearIncorrectMatch && req.method === "POST") {
      await readJson(req, practiceScopeSchema);
      await service.clearIncorrectQuestion(decodedRowId(clearIncorrectMatch[1]));
      json(res, 200, { success: true });
      return true;
    }
    return false;
  };
}
