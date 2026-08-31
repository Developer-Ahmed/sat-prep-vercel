import { handleClerkProxy, restoreProxyRequestUrl } from "../server/clerk-proxy.js";

export default async function handler(req, res) {
  try {
    req.url = restoreProxyRequestUrl(req.url);
  } catch {
    res.statusCode = 400;
    res.setHeader("cache-control", "no-store");
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ errors: [{ code: "invalid_proxy_path", message: "Invalid authentication path." }] }));
    return;
  }
  await handleClerkProxy(req, res);
}
