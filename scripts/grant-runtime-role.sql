DO $$
DECLARE
  runtime_role pg_roles%ROWTYPE;
BEGIN
  SELECT * INTO runtime_role
  FROM pg_roles
  WHERE rolname = 'sat_app';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The sat_app runtime role does not exist.';
  END IF;

  IF runtime_role.rolsuper
    OR runtime_role.rolcreatedb
    OR runtime_role.rolcreaterole
    OR runtime_role.rolinherit
    OR runtime_role.rolreplication
    OR runtime_role.rolbypassrls
    OR NOT runtime_role.rolcanlogin
    OR EXISTS (
      SELECT 1
      FROM pg_roles elevated
      WHERE (elevated.rolsuper OR elevated.rolbypassrls)
        AND pg_has_role('sat_app', elevated.oid, 'MEMBER')
    )
  THEN
    RAISE EXCEPTION 'The sat_app runtime role is elevated or incorrectly configured.';
  END IF;
END
$$;

ALTER ROLE sat_app SET statement_timeout = '30s';
ALTER ROLE sat_app SET lock_timeout = '5s';
ALTER ROLE sat_app SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE sat_app SET search_path = public, pg_catalog;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM sat_app;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM sat_app;
REVOKE ALL PRIVILEGES ON SCHEMA public FROM sat_app;
GRANT USAGE ON SCHEMA public TO sat_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON app_users TO sat_app;
GRANT SELECT ON questions, question_source_refs, question_pool_memberships, question_content TO sat_app;
GRANT SELECT ON app_settings TO sat_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON clerk_webhook_events TO sat_app;
GRANT SELECT ON question_catalog TO sat_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON progress TO sat_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON test_sessions, test_modules, module_questions TO sat_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON response_time_segments TO sat_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON vocab_items TO sat_app;
GRANT SELECT ON vocab_sets, vocab_set_items TO sat_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_vocab_set_items, vocab_progress, vocab_reviews TO sat_app;

GRANT USAGE, SELECT ON SEQUENCE test_sessions_id_seq, test_modules_id_seq TO sat_app;
GRANT USAGE, SELECT ON SEQUENCE vocab_items_id_seq, vocab_reviews_id_seq TO sat_app;
