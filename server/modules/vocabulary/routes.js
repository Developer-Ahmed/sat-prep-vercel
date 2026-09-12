import { parseInput, readJson } from "../../platform/http.js";
import { addWordSchema, reviewSchema, vocabQueryFromUrl, vocabQuerySchema } from "./contracts.js";

export function createVocabularyRoutes({ service, json }) {
  return async function handleVocabularyRoute(req, res, url) {
    const query = () => parseInput(vocabQuerySchema, vocabQueryFromUrl(url));

    if (url.pathname === "/api/vocab/bootstrap" && req.method === "GET") {
      const { kind, set } = query();
      const [sets, dashboard] = await Promise.all([
        service.listVocabSets(kind),
        service.vocabDashboard(kind, set)
      ]);
      json(res, 200, { success: true, data: { sets, dashboard } });
      return true;
    }
    if (url.pathname === "/api/vocab/sets" && req.method === "GET") {
      const { kind } = query();
      json(res, 200, { success: true, data: await service.listVocabSets(kind) });
      return true;
    }
    if (url.pathname === "/api/vocab/dashboard" && req.method === "GET") {
      const { kind, set } = query();
      json(res, 200, { success: true, data: await service.vocabDashboard(kind, set) });
      return true;
    }
    if (url.pathname === "/api/vocab/session" && req.method === "GET") {
      const { kind, set, limit } = query();
      json(res, 200, { success: true, data: await service.vocabSession(kind, limit, set) });
      return true;
    }
    if (url.pathname === "/api/vocab/items" && req.method === "GET") {
      const { kind, set, search } = query();
      json(res, 200, { success: true, data: await service.listVocabItems(kind, search, set) });
      return true;
    }
    if (url.pathname === "/api/vocab/words" && req.method === "POST") {
      const body = await readJson(req, addWordSchema);
      json(res, 201, { success: true, data: await service.addVocabWord(body) });
      return true;
    }
    if (url.pathname === "/api/vocab/review" && req.method === "POST") {
      const body = await readJson(req, reviewSchema);
      json(res, 200, {
        success: true,
        data: await service.reviewVocabItem(body.itemId, body.rating, body.setId, body.requestId)
      });
      return true;
    }
    return false;
  };
}
