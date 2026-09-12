import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const migrationPath = fileURLToPath(new URL("../migrations/002_normalize_test_sessions.sql", import.meta.url));
const migration = await readFile(migrationPath, "utf8");
const initialMigrationPath = fileURLToPath(new URL("../migrations/001_initial.sql", import.meta.url));
const initialMigration = await readFile(initialMigrationPath, "utf8");
const rlsMigrationPath = fileURLToPath(new URL("../migrations/004_tenant_row_security.sql", import.meta.url));
const rlsMigration = await readFile(rlsMigrationPath, "utf8");
const indexMigrationPath = fileURLToPath(new URL("../migrations/005_targeted_indexes.sql", import.meta.url));
const indexMigration = await readFile(indexMigrationPath, "utf8");
const webhookMigrationPath = fileURLToPath(new URL("../migrations/006_clerk_webhook_events.sql", import.meta.url));
const webhookMigration = await readFile(webhookMigrationPath, "utf8");
const boundsMigrationPath = fileURLToPath(new URL("../migrations/007_data_bounds.sql", import.meta.url));
const boundsMigration = await readFile(boundsMigrationPath, "utf8");
const responseMergeMigrationPath = fileURLToPath(new URL("../migrations/008_merge_module_responses.sql", import.meta.url));
const responseMergeMigration = await readFile(responseMergeMigrationPath, "utf8");

test("final test schema stores response state with each assigned module question", () => {
  for (const table of [
    "test_sessions",
    "test_modules",
    "module_questions",
    "response_time_segments"
  ]) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  }
  assert.match(responseMergeMigration, /ALTER TABLE module_questions[\s\S]*ADD COLUMN answer/);
  assert.match(responseMergeMigration, /DROP TABLE module_responses/);
  assert.doesNotMatch(migration, /question_ids/i);
});

test("test schema enforces tenant-scoped membership and cascade ownership", () => {
  assert.match(migration, /FOREIGN KEY \(user_id, session_id\)[\s\S]*ON DELETE CASCADE/);
  assert.match(migration, /UNIQUE \(user_id, module_id, row_id\)/);
  assert.match(responseMergeMigration, /response_time_segments_module_question_fkey[\s\S]*REFERENCES module_questions/);
});

test("module question responses use PostgreSQL types and enforce consistent results", () => {
  assert.match(responseMergeMigration, /ADD COLUMN flagged boolean NOT NULL DEFAULT false/);
  assert.match(responseMergeMigration, /ADD COLUMN is_correct boolean/);
  assert.match(responseMergeMigration, /ADD COLUMN time_spent_seconds integer NOT NULL DEFAULT 0/);
  assert.match(migration, /pass_index smallint NOT NULL CHECK \(pass_index > 0\)/);
  assert.match(responseMergeMigration, /status = 'correct' AND is_correct/);
  assert.match(responseMergeMigration, /status = 'incorrect' AND NOT is_correct/);
});

test("response merge copies existing data before dropping the old table", () => {
  const copyPosition = responseMergeMigration.indexOf("UPDATE module_questions AS mq");
  const foreignKeyPosition = responseMergeMigration.indexOf("response_time_segments_module_question_fkey");
  const dropPosition = responseMergeMigration.indexOf("DROP TABLE module_responses");
  assert.ok(copyPosition >= 0);
  assert.match(responseMergeMigration, /Module response migration validation failed/);
  assert.ok(foreignKeyPosition > copyPosition);
  assert.ok(dropPosition > foreignKeyPosition);
});

test("question catalog has one canonical row with separate source and pool membership", () => {
  assert.match(initialMigration, /CREATE TABLE IF NOT EXISTS question_source_refs/);
  assert.match(initialMigration, /PRIMARY KEY \(source, source_question_id\)/);
  assert.match(initialMigration, /CREATE TABLE IF NOT EXISTS question_pool_memberships/);
  assert.match(initialMigration, /PRIMARY KEY \(question_row_id, pool\)/);
  assert.match(initialMigration, /CREATE VIEW question_catalog/);
});

test("catalog content and state use native PostgreSQL types", () => {
  assert.match(initialMigration, /raw_json jsonb NOT NULL/);
  assert.match(initialMigration, /data_json jsonb NOT NULL/);
  assert.match(initialMigration, /excluded_bluebook boolean NOT NULL DEFAULT false/);
  assert.match(initialMigration, /flagged boolean NOT NULL DEFAULT false/);
  assert.match(initialMigration, /status IN \('correct', 'incorrect'\) AND answered_at IS NOT NULL/);
  assert.match(initialMigration, /correct = \(rating <> 'again'\)/);
});

test("database checks reject blank identifiers and malformed review keys", () => {
  assert.match(initialMigration, /id text PRIMARY KEY CHECK \(btrim\(id\) <> ''\)/);
  assert.match(initialMigration, /term text NOT NULL CHECK \(btrim\(term\) <> ''\)/);
  assert.match(initialMigration, /request_id text NOT NULL CHECK \(request_id ~/);
  assert.match(migration, /title text NOT NULL CHECK \(btrim\(title\) <> ''\)/);
});

test("every tenant-owned table has PostgreSQL row-level security", () => {
  for (const table of [
    "app_users",
    "progress",
    "test_sessions",
    "test_modules",
    "module_questions",
    "response_time_segments",
    "user_vocab_set_items",
    "vocab_progress",
    "vocab_reviews"
  ]) {
    assert.match(rlsMigration, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
  }
  assert.match(rlsMigration, /current_setting\('app\.user_id', true\)/);
});

test("vocabulary reviews have a tenant-scoped idempotency key", () => {
  assert.match(initialMigration, /request_id text NOT NULL/);
  assert.match(initialMigration, /idx_vocab_reviews_user_request/);
  assert.match(initialMigration, /ON vocab_reviews\(user_id, request_id\)/);
});

test("vocabulary memberships preserve set-specific wording", () => {
  assert.match(initialMigration, /CREATE TABLE IF NOT EXISTS vocab_set_items[\s\S]*display_definition text/);
  assert.match(initialMigration, /CREATE TABLE IF NOT EXISTS user_vocab_set_items[\s\S]*display_example text/);
});

test("high-volume foreign-key references have supporting indexes", () => {
  for (const index of [
    "idx_progress_question",
    "idx_module_questions_question",
    "idx_user_vocab_set_items_item",
    "idx_vocab_progress_item",
    "idx_vocab_reviews_item"
  ]) {
    assert.match(indexMigration, new RegExp(`CREATE INDEX IF NOT EXISTS ${index}\\b`));
  }
});

test("Clerk webhook receipts are minimal, deduplicated, and bounded", () => {
  assert.match(webhookMigration, /event_id text PRIMARY KEY/);
  assert.match(webhookMigration, /payload_sha256 text NOT NULL/);
  assert.match(webhookMigration, /processed_at timestamptz/);
  assert.doesNotMatch(webhookMigration, /payload\s+jsonb|email|first_name|last_name/i);
});

test("database constraints mirror public API size and timing limits", () => {
  assert.match(responseMergeMigration, /module_questions_answer_length[\s\S]*char_length\(answer\) <= 32/);
  assert.match(responseMergeMigration, /module_questions_time_limit[\s\S]*time_spent_seconds <= 21600/);
  assert.match(boundsMigration, /test_modules_duration_limit[\s\S]*duration_seconds <= 10800/);
  assert.match(boundsMigration, /response_time_segments_pass_limit[\s\S]*pass_index <= 200/);
  assert.match(boundsMigration, /vocab_items_definition_length[\s\S]*char_length\(definition\) <= 600/);
  assert.match(boundsMigration, /user_vocab_set_items_display_example_length/);
});
