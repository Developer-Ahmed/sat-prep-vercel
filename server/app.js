import { readFile } from "node:fs/promises";
import { AsyncLocalStorage } from "node:async_hooks";
import { extname, join } from "node:path";
import { isKnownPath as isKnownAppRoute } from "../public/shared/auth-runtime.js";
import * as clerkAuth from "./auth.js";
import { errorPayload, HttpError } from "./platform/http.js";
import { applySecurityHeaders, enforceTrustedOrigin } from "./platform/security.js";
import { createCatalogService } from "./modules/catalog/service.js";
import { createCatalogRoutes } from "./modules/catalog/routes.js";
import { createPracticeService } from "./modules/practice/service.js";
import { createPracticeRoutes } from "./modules/practice/routes.js";
import { createVocabularyService } from "./modules/vocabulary/service.js";
import { createVocabularyRoutes } from "./modules/vocabulary/routes.js";
import { createUserService } from "./modules/users/service.js";
import { createUserRoutes } from "./modules/users/routes.js";
import { errorLogFields, logEvent, requestIdFor } from "./observability.js";
import { resolvePublicPath } from "./static-path.js";

export function createApplication({ db, publicDir, auth = clerkAuth, logger = logEvent }) {
  if (!db) throw new Error("A database adapter is required.");
  if (!publicDir) throw new Error("A public directory is required.");

  const requestContext = new AsyncLocalStorage();

  function json(res, status, body) {
    const payload = JSON.stringify(body);
    applySecurityHeaders(res);
    res.writeHead(status, {
      "cache-control": "private, no-store",
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(payload),
      "x-content-type-options": "nosniff"
    });
    res.end(payload);
  }

  function currentUserId() {
    const userId = requestContext.getStore()?.userId;
    if (!userId) throw new Error("Authenticated user context is missing.");
    return userId;
  }

  function requireAdmin() {
    if (!auth.isAdmin(currentUserId())) {
      throw new HttpError(403, "ADMIN_REQUIRED", "Only an administrator can update the shared question catalog.");
    }
  }

  const catalog = createCatalogService({ db, currentUserId });
  const practice = createPracticeService({ db, currentUserId, catalog, isAdmin: auth.isAdmin });
  const vocabulary = createVocabularyService({ db, currentUserId });
  const users = createUserService({ db, currentUserId, practice });
  const handleCatalogRoute = createCatalogRoutes({ service: catalog, json, requireAdmin });
  const handlePracticeRoute = createPracticeRoutes({ service: practice, json });
  const handleVocabularyRoute = createVocabularyRoutes({ service: vocabulary, json });
  const { handlePublicUserRoute, handleUserRoute } = createUserRoutes({
    service: users,
    json,
    verifyWebhook: auth.verifyClerkWebhook,
    logWebhookError(error, phase) {
      logger(phase === "verification" ? "warn" : "error", `clerk.webhook.${phase}.failed`, {
        requestId: requestContext.getStore()?.requestId,
        ...errorLogFields(error)
      });
    }
  });

  async function serveStatic(pathname, res) {
    const filePath = resolvePublicPath(publicDir, pathname);
    if (!filePath) return json(res, 403, { success: false, error: "Forbidden" });

    try {
      const data = await readFile(filePath);
      const types = {
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".png": "image/png",
        ".svg": "image/svg+xml"
      };
      applySecurityHeaders(res);
      res.writeHead(200, {
        "cache-control": extname(filePath) === ".html" ? "no-cache" : "public, max-age=0, must-revalidate",
        "content-type": types[extname(filePath)] || "application/octet-stream"
      });
      res.end(data);
    } catch {
      const data = await readFile(join(publicDir, "index.html"));
      applySecurityHeaders(res);
      res.writeHead(isKnownAppRoute(pathname) ? 200 : 404, {
        "cache-control": "no-cache",
        "content-type": "text/html; charset=utf-8"
      });
      res.end(data);
    }
  }

  async function route(req, res, authenticated = false) {
    const activeContext = requestContext.getStore();
    if (!activeContext?.requestId) {
      const requestId = requestIdFor(req);
      const startedAt = Date.now();
      const requestPath = new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname;
      res.setHeader("x-request-id", requestId);
      if (requestPath.startsWith("/api/") && typeof res.once === "function") {
        res.once("finish", () => logger("info", "api.request.completed", {
          requestId,
          method: req.method,
          path: requestPath,
          statusCode: res.statusCode,
          durationMs: Date.now() - startedAt
        }));
      }
      return requestContext.run({ requestId }, () => route(req, res, authenticated));
    }

    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname === "/api/auth-config" && req.method === "GET") {
      return json(res, 200, { success: true, data: auth.clerkPublicConfig() });
    }
    if (url.pathname === "/api/health" && req.method === "GET") {
      return json(res, 200, { success: true, data: { status: "ok" } });
    }
    if (await handlePublicUserRoute(req, res, url)) return;

    if (url.pathname.startsWith("/api/") && !authenticated) {
      try {
        const verified = await auth.authenticateRequest(req);
        if (!verified) return json(res, 401, { success: false, error: "Sign in is required." });
        return db.runAsUser(verified.userId, () => requestContext.run(
          { ...requestContext.getStore(), userId: verified.userId },
          async () => {
            await users.ensureUser(verified.userId);
            return route(req, res, true);
          }
        ));
      } catch (error) {
        logger("error", "auth.request.failed", {
          requestId: requestContext.getStore()?.requestId,
          method: req.method,
          path: url.pathname,
          ...errorLogFields(error)
        });
        return json(res, 500, { success: false, error: "Authentication could not be verified." });
      }
    }

    try {
      if (authenticated) enforceTrustedOrigin(req, auth.authorizedParties(req));
      if (await handleUserRoute(req, res, url)) return;
      if (await handleVocabularyRoute(req, res, url)) return;
      if (await handlePracticeRoute(req, res, url)) return;
      if (await handleCatalogRoute(req, res, url)) return;
      if (url.pathname.startsWith("/api/")) {
        return json(res, 404, { success: false, error: "API route not found." });
      }
      await serveStatic(url.pathname, res);
    } catch (error) {
      const requestId = requestContext.getStore()?.requestId;
      logger("error", "api.request.failed", {
        requestId,
        method: req.method,
        path: url.pathname,
        ...errorLogFields(error)
      });
      const response = errorPayload(error, requestId);
      json(res, response.statusCode, response.body);
    }
  }

  return Object.freeze({ route });
}
