import { route } from "../server/index.js";

export default async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
  const routePath = url.searchParams.get("__path") || "";
  url.searchParams.delete("__path");
  const query = url.searchParams.toString();
  req.url = `/api/${routePath}${query ? `?${query}` : ""}`;
  await route(req, res);
}
