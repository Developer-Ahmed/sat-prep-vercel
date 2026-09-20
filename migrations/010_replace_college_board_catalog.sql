-- College Board does not permit its Question Bank content to be displayed by
-- this application. Remove all existing assessment history and catalog rows so
-- no prohibited prompt, answer, rationale, or source identifier remains.
DELETE FROM test_sessions;
DELETE FROM progress;
DELETE FROM questions;

DELETE FROM app_settings
WHERE key LIKE 'activeSource:%'
   OR key LIKE 'catalog:%'
   OR key LIKE 'contentCache:%';

DROP VIEW question_catalog;

DROP INDEX IF EXISTS idx_questions_subject_available;
DROP INDEX IF EXISTS idx_questions_subject_domain_available;
DROP INDEX IF EXISTS idx_questions_subject_difficulty_available;

ALTER TABLE questions
  DROP COLUMN excluded_bluebook;

ALTER TABLE question_source_refs
  DROP CONSTRAINT question_source_refs_source_check,
  DROP COLUMN uid,
  DROP COLUMN external_id,
  DROP COLUMN ibn,
  ADD CONSTRAINT question_source_refs_source_check
    CHECK (source IN ('peak1600'));

ALTER TABLE question_pool_memberships
  DROP CONSTRAINT question_pool_memberships_pool_check,
  ADD CONSTRAINT question_pool_memberships_pool_check
    CHECK (pool IN ('main'));

CREATE INDEX idx_questions_subject_domain
  ON questions(subject, domain_desc);
CREATE INDEX idx_questions_subject_difficulty
  ON questions(subject, difficulty);

CREATE VIEW question_catalog AS
SELECT
  q.row_id,
  q.subject,
  pm.pool,
  sr.source,
  sr.source_question_id AS question_id,
  q.program,
  q.domain,
  q.domain_desc,
  q.skill,
  q.skill_desc,
  q.difficulty,
  q.raw_json,
  q.imported_at
FROM questions q
JOIN question_pool_memberships pm ON pm.question_row_id = q.row_id AND pm.active
JOIN question_source_refs sr ON sr.question_row_id = q.row_id;

INSERT INTO app_settings (key, value)
VALUES ('catalog:copyrightPolicy', 'independently-authored-only')
ON CONFLICT(key) DO UPDATE SET value = excluded.value;
