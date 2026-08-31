import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createApplication } from "./app.js";
import { validateRuntimeConfiguration } from "./config.js";
import { openDatabase } from "./database.js";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 5174);

validateRuntimeConfiguration();
const db = await openDatabase();
const { route } = createApplication({ db, publicDir: resolve(rootDir, "public") });

export { route };

const isMainModule = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule && !process.env.VERCEL) {
  createServer(route).listen(port, host, () => {
    console.log(`SAT prep app running at http://${host}:${port}`);
    console.log("Database: Neon PostgreSQL");
  });
}
