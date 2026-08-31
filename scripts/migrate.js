import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@neondatabase/serverless";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const migrationsDir = resolve(rootDir, "migrations");
const databaseUrl = process.env.DATABASE_ADMIN_URL;

if (!databaseUrl) throw new Error("DATABASE_ADMIN_URL is required for schema migrations.");
if (!databaseUrl.includes("sslmode=require")) {
  console.warn("DATABASE_ADMIN_URL does not explicitly contain sslmode=require; use a TLS-protected Neon connection string.");
}

const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock($1)", [729481]);
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      checksum text,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query("ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum text");

  const files = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();
  const fileSet = new Set(files);
  const appliedResult = await client.query("SELECT name, checksum FROM schema_migrations");
  const unknown = appliedResult.rows.filter((row) => !fileSet.has(row.name));
  if (unknown.length) {
    throw new Error(`Applied migration files are missing from the repository: ${unknown.map((row) => row.name).join(", ")}`);
  }
  const applied = new Map(appliedResult.rows.map((row) => [row.name, row.checksum]));

  for (const name of files) {
    const source = await readFile(resolve(migrationsDir, name), "utf8");
    const checksum = createHash("sha256").update(source).digest("hex");
    if (applied.has(name)) {
      const recorded = applied.get(name);
      if (!recorded) {
        throw new Error(`Migration ${name} predates checksum tracking. Reset preproduction before continuing.`);
      }
      if (recorded !== checksum) {
        throw new Error(`Migration drift detected for ${name}. Applied migrations must never be edited.`);
      }
      continue;
    }
    await client.query(source);
    await client.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [name, checksum]);
    console.log(`Applied ${name}`);
  }

  await client.query("ALTER TABLE schema_migrations ALTER COLUMN checksum SET NOT NULL");
  await client.query("COMMIT");
  console.log("Database migrations are current.");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
