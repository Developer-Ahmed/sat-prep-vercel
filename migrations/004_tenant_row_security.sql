ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE test_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE module_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE module_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE response_time_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE vocab_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_vocab_set_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE vocab_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE vocab_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY app_users_isolate_tenant ON app_users
  USING (id = NULLIF(current_setting('app.user_id', true), ''))
  WITH CHECK (id = NULLIF(current_setting('app.user_id', true), ''));

CREATE POLICY progress_isolate_tenant ON progress
  USING (user_id = NULLIF(current_setting('app.user_id', true), ''))
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), ''));

CREATE POLICY test_sessions_isolate_tenant ON test_sessions
  USING (user_id = NULLIF(current_setting('app.user_id', true), ''))
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), ''));

CREATE POLICY test_modules_isolate_tenant ON test_modules
  USING (user_id = NULLIF(current_setting('app.user_id', true), ''))
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), ''));

CREATE POLICY module_questions_isolate_tenant ON module_questions
  USING (user_id = NULLIF(current_setting('app.user_id', true), ''))
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), ''));

CREATE POLICY module_responses_isolate_tenant ON module_responses
  USING (user_id = NULLIF(current_setting('app.user_id', true), ''))
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), ''));

CREATE POLICY response_time_segments_isolate_tenant ON response_time_segments
  USING (user_id = NULLIF(current_setting('app.user_id', true), ''))
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), ''));

CREATE POLICY vocab_items_read_visible ON vocab_items FOR SELECT
  USING (
    owner_user_id IS NULL
    OR owner_user_id = NULLIF(current_setting('app.user_id', true), '')
  );
CREATE POLICY vocab_items_insert_owned ON vocab_items FOR INSERT
  WITH CHECK (owner_user_id = NULLIF(current_setting('app.user_id', true), ''));
CREATE POLICY vocab_items_update_owned ON vocab_items FOR UPDATE
  USING (owner_user_id = NULLIF(current_setting('app.user_id', true), ''))
  WITH CHECK (owner_user_id = NULLIF(current_setting('app.user_id', true), ''));
CREATE POLICY vocab_items_delete_owned ON vocab_items FOR DELETE
  USING (owner_user_id = NULLIF(current_setting('app.user_id', true), ''));

CREATE POLICY user_vocab_set_items_isolate_tenant ON user_vocab_set_items
  USING (user_id = NULLIF(current_setting('app.user_id', true), ''))
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), ''));

CREATE POLICY vocab_progress_isolate_tenant ON vocab_progress
  USING (user_id = NULLIF(current_setting('app.user_id', true), ''))
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), ''));

CREATE POLICY vocab_reviews_isolate_tenant ON vocab_reviews
  USING (user_id = NULLIF(current_setting('app.user_id', true), ''))
  WITH CHECK (user_id = NULLIF(current_setting('app.user_id', true), ''));
