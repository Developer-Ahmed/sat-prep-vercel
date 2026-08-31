import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@neondatabase/serverless";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const connectionString = process.env.DATABASE_ADMIN_URL;
if (!connectionString) throw new Error("DATABASE_ADMIN_URL is required to grant runtime privileges.");

const grants = await readFile(resolve(rootDir, "scripts/grant-runtime-role.sql"), "utf8");
const client = new Client({ connectionString });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query(grants);
  await client.query("COMMIT");
  console.log("Restricted runtime privileges are current.");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
