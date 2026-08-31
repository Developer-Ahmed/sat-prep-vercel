import { createHash } from "node:crypto";
import { readBody, readJson } from "../../platform/http.js";
import { resetProgressSchema } from "./contracts.js";

export function createUserRoutes({ service, json, verifyWebhook, logWebhookError }) {
  async function handlePublicUserRoute(req, res, url) {
    if (url.pathname !== "/api/webhooks/clerk" || req.method !== "POST") return false;

    let body;
    let event;
    try {
      body = await readBody(req, { maxBytes: 128 * 1024 });
      event = await verifyWebhook(req, body);
    } catch (error) {
      logWebhookError?.(error, "verification");
      json(res, 400, { success: false, error: "Webhook could not be verified." });
      return true;
    }

    const eventId = String(req.headers?.["svix-id"] || "");
    const eventType = String(event.type || "");
    const userId = eventType.startsWith("user.")
      ? String(event.data?.id || "").trim() || null
      : null;
    try {
      const result = await service.processClerkWebhook({
        eventId,
        eventType,
        payloadSha256: createHash("sha256").update(body).digest("hex"),
        userId
      });
      json(res, 200, { success: true, duplicate: result.duplicate });
    } catch (error) {
      logWebhookError?.(error, "processing");
      json(res, 500, { success: false, error: "Webhook could not be processed." });
    }
    return true;
  }

  async function handleUserRoute(req, res, url) {
    if (url.pathname === "/api/reset-progress" && req.method === "POST") {
      const { subject, pool } = await readJson(req, resetProgressSchema);
      json(res, 200, { success: true, data: await service.resetProgress(subject, pool) });
      return true;
    }
    return false;
  }

  return { handlePublicUserRoute, handleUserRoute };
}
