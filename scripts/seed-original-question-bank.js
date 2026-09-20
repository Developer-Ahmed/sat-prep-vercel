import { createHash } from "node:crypto";
import { Client } from "@neondatabase/serverless";
import {
  ORIGINAL_QUESTION_BANK,
  ORIGINAL_QUESTION_BANK_VERSION
} from "../server/modules/catalog/original-question-bank.js";
import { sanitizeQuestionContent } from "../server/platform/question-content.js";

const databaseUrl = process.env.DATABASE_ADMIN_URL;
if (!databaseUrl) throw new Error("DATABASE_ADMIN_URL is required to seed the original question bank.");

function validateQuestion(question, ids, prompts) {
  if (!/^(?:math|english):p16-[a-z0-9-]+$/.test(question.rowId)) {
    throw new Error(`Invalid original question row ID: ${question.rowId}`);
  }
  if (ids.has(question.rowId)) throw new Error(`Duplicate original question ID: ${question.rowId}`);
  ids.add(question.rowId);

  const promptKey = JSON.stringify([
    question.subject,
    question.content.stimulus,
    question.content.stem,
    question.content.answerOptions
      ? Object.values(question.content.answerOptions).sort()
      : null
  ]);
  if (prompts.has(promptKey)) throw new Error(`Duplicate original prompt: ${question.rowId}`);
  prompts.add(promptKey);

  if (question.source !== "peak1600" || question.rawJson?.independentlyAuthored !== true) {
    throw new Error(`Question lacks original-content provenance: ${question.rowId}`);
  }
  if (!["E", "M", "H"].includes(question.difficulty)) {
    throw new Error(`Invalid difficulty for ${question.rowId}`);
  }
  if (!question.content?.stem || !Array.isArray(question.content.correct_answer) || !question.content.correct_answer.length) {
    throw new Error(`Question is missing a prompt or answer key: ${question.rowId}`);
  }
  const options = question.content.answerOptions;
  if (options) {
    const keys = Object.keys(options);
    if (keys.length !== 4 || !question.content.correct_answer.every((answer) => keys.includes(answer))) {
      throw new Error(`Question has an invalid multiple-choice key: ${question.rowId}`);
    }
  }
}

const ids = new Set();
const prompts = new Set();
for (const question of ORIGINAL_QUESTION_BANK) validateQuestion(question, ids, prompts);

const subjectCounts = Object.fromEntries(["math", "english"].map((subject) => [
  subject,
  ORIGINAL_QUESTION_BANK.filter((question) => question.subject === subject).length
]));
if (subjectCounts.math < 88 || subjectCounts.english < 108) {
  throw new Error("The original bank must support at least one complete Math and two-module Reading/Writing section.");
}

const checksum = createHash("sha256").update(JSON.stringify(ORIGINAL_QUESTION_BANK)).digest("hex");
const seedPayload = JSON.stringify(ORIGINAL_QUESTION_BANK.map((question) => ({
  row_id: question.rowId,
  source_question_id: question.sourceQuestionId,
  subject: question.subject,
  program: question.program,
  domain: question.domain,
  domain_desc: question.domainDesc,
  skill: question.skill,
  skill_desc: question.skillDesc,
  difficulty: question.difficulty,
  raw_json: question.rawJson,
  content: sanitizeQuestionContent(question.content)
})));
const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock($1)", [729483]);
  await client.query(`
    UPDATE question_pool_memberships AS membership
    SET active = false, last_seen_at = now()
    FROM question_source_refs AS source_ref
    WHERE source_ref.question_row_id = membership.question_row_id
      AND source_ref.source = 'peak1600'
  `);

  await client.query(`
    INSERT INTO questions (
      row_id, subject, program, domain, domain_desc, skill, skill_desc,
      difficulty, raw_json, imported_at
    )
    SELECT
      item.row_id, item.subject, item.program, item.domain, item.domain_desc,
      item.skill, item.skill_desc, item.difficulty, item.raw_json, now()
    FROM jsonb_to_recordset($1::jsonb) AS item(
      row_id text, source_question_id text, subject text, program text,
      domain text, domain_desc text, skill text, skill_desc text,
      difficulty text, raw_json jsonb, content jsonb
    )
    ON CONFLICT(row_id) DO UPDATE SET
      subject = excluded.subject,
      program = excluded.program,
      domain = excluded.domain,
      domain_desc = excluded.domain_desc,
      skill = excluded.skill,
      skill_desc = excluded.skill_desc,
      difficulty = excluded.difficulty,
      raw_json = excluded.raw_json,
      imported_at = excluded.imported_at,
      updated_at = now()
  `, [seedPayload]);
  await client.query(`
    INSERT INTO question_source_refs (
      question_row_id, source, source_question_id, first_seen_at, last_seen_at
    )
    SELECT item.row_id, 'peak1600', item.source_question_id, now(), now()
    FROM jsonb_to_recordset($1::jsonb) AS item(row_id text, source_question_id text)
    ON CONFLICT(source, source_question_id) DO UPDATE SET
      question_row_id = excluded.question_row_id,
      last_seen_at = excluded.last_seen_at
  `, [seedPayload]);
  await client.query(`
    INSERT INTO question_pool_memberships (
      question_row_id, pool, active, first_seen_at, last_seen_at
    )
    SELECT item.row_id, 'main', true, now(), now()
    FROM jsonb_to_recordset($1::jsonb) AS item(row_id text)
    ON CONFLICT(question_row_id, pool) DO UPDATE SET
      active = true,
      last_seen_at = excluded.last_seen_at
  `, [seedPayload]);
  await client.query(`
    INSERT INTO question_content (question_row_id, data_json, fetched_at)
    SELECT item.row_id, item.content, now()
    FROM jsonb_to_recordset($1::jsonb) AS item(row_id text, content jsonb)
    ON CONFLICT(question_row_id) DO UPDATE SET
      data_json = excluded.data_json,
      fetched_at = excluded.fetched_at,
      content_version = question_content.content_version + 1
  `, [seedPayload]);

  for (const subject of ["math", "english"]) {
    await client.query(`
      INSERT INTO app_settings (key, value)
      VALUES ($1, 'peak1600')
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `, [`activeSource:${subject}:main`]);
  }
  await client.query(`
    INSERT INTO app_settings (key, value)
    VALUES
      ('catalog:bankVersion', $1),
      ('catalog:bankChecksum', $2),
      ('catalog:copyrightPolicy', 'independently-authored-only')
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `, [ORIGINAL_QUESTION_BANK_VERSION, checksum]);
  await client.query("COMMIT");
  console.log(
    `Original question bank ${ORIGINAL_QUESTION_BANK_VERSION} is current ` +
    `(${subjectCounts.math} Math, ${subjectCounts.english} Reading/Writing; ${checksum.slice(0, 12)}).`
  );
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
