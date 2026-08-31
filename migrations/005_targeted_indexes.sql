DROP INDEX IF EXISTS idx_progress_user_status;
DROP INDEX IF EXISTS idx_module_responses_module_status;

CREATE INDEX IF NOT EXISTS idx_questions_subject_domain_available
  ON questions(subject, domain_desc) WHERE NOT excluded_bluebook;
CREATE INDEX IF NOT EXISTS idx_questions_subject_difficulty_available
  ON questions(subject, difficulty) WHERE NOT excluded_bluebook;
CREATE INDEX IF NOT EXISTS idx_progress_user_incorrect
  ON progress(user_id, row_id) WHERE status = 'incorrect';
CREATE INDEX IF NOT EXISTS idx_progress_user_flagged
  ON progress(user_id, row_id) WHERE flagged;

-- PostgreSQL does not create indexes on referencing foreign-key columns.
CREATE INDEX IF NOT EXISTS idx_progress_question
  ON progress(row_id);
CREATE INDEX IF NOT EXISTS idx_module_questions_question
  ON module_questions(row_id);
CREATE INDEX IF NOT EXISTS idx_user_vocab_set_items_item
  ON user_vocab_set_items(item_id);
CREATE INDEX IF NOT EXISTS idx_user_vocab_set_items_set
  ON user_vocab_set_items(set_id, item_id);
CREATE INDEX IF NOT EXISTS idx_vocab_progress_item
  ON vocab_progress(item_id);
CREATE INDEX IF NOT EXISTS idx_vocab_progress_set
  ON vocab_progress(set_id, item_id);
CREATE INDEX IF NOT EXISTS idx_vocab_reviews_item
  ON vocab_reviews(item_id);
CREATE INDEX IF NOT EXISTS idx_vocab_reviews_set
  ON vocab_reviews(set_id, item_id);
