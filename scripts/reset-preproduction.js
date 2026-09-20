import { neon } from "@neondatabase/serverless";

const confirmation = process.env.CONFIRM_RESET_PREPRODUCTION;
if (confirmation !== "DELETE_ALL_DATA") {
  throw new Error("Refusing to reset. Set CONFIRM_RESET_PREPRODUCTION=DELETE_ALL_DATA to continue.");
}

const databaseUrl = process.env.DATABASE_ADMIN_URL;
if (!databaseUrl) throw new Error("DATABASE_ADMIN_URL is required for a preproduction reset.");

const sql = neon(databaseUrl, { fullResults: true });
const tables = [
  "clerk_webhook_events",
  "response_time_segments",
  "module_responses",
  "module_questions",
  "test_modules",
  "test_sessions",
  "module_time_segments",
  "module_answers",
  "modules",
  "vocab_reviews",
  "vocab_progress",
  "user_vocab_set_items",
  "vocab_set_items",
  "vocab_sets",
  "vocab_items",
  "progress",
  "question_content",
  "question_pool_memberships",
  "question_source_refs",
  "questions",
  "app_settings",
  "app_users",
  "schema_migrations"
];

await sql.transaction([
  sql.query("SELECT pg_advisory_xact_lock($1)", [729481]),
  sql.query("DROP VIEW IF EXISTS question_catalog CASCADE"),
  ...tables.map((table) => sql.query(`DROP TABLE IF EXISTS ${table} CASCADE`))
]);

await import("./migrate.js");
await import("./seed-reference-data.js");
await import("./seed-original-question-bank.js");

const role = await sql.query("SELECT 1 FROM pg_roles WHERE rolname = 'sat_app'");
if (role.rows.length) {
  await import("./grant-runtime.js");
}

console.log("Preproduction database reset complete. All previous application data was deleted.");
