import { parseInput } from "../../platform/http.js";
import { catalogScopeFromUrl } from "../catalog/contracts.js";
import { practiceScopeSchema } from "../practice/contracts.js";

export function createDashboardRoutes({ practice, catalog, json }) {
  return async function handleDashboardRoute(req, res, url) {
    if (url.pathname !== "/api/dashboard" || req.method !== "GET") return false;

    const { subject, pool } = parseInput(practiceScopeSchema, catalogScopeFromUrl(url));
    const [status, modules, cacheJob] = await Promise.all([
      practice.getStatus(subject, pool),
      practice.listModules(subject, pool),
      catalog.publicCacheJob(subject, pool)
    ]);
    json(res, 200, { success: true, data: { status, modules, cacheJob } });
    return true;
  };
}
