ALTER TABLE app_users
  ADD CONSTRAINT app_users_id_length CHECK (char_length(id) <= 128);

ALTER TABLE progress
  ADD CONSTRAINT progress_answer_length CHECK (char_length(COALESCE(selected_answer, '')) <= 32);

ALTER TABLE test_modules
  ADD CONSTRAINT test_modules_title_length CHECK (char_length(title) <= 200),
  ADD CONSTRAINT test_modules_duration_limit CHECK (duration_seconds <= 10800);

ALTER TABLE module_questions
  ADD CONSTRAINT module_questions_position_limit CHECK (position <= 98);

ALTER TABLE module_responses
  ADD CONSTRAINT module_responses_answer_length CHECK (char_length(answer) <= 32),
  ADD CONSTRAINT module_responses_time_limit CHECK (time_spent_seconds <= 21600);

ALTER TABLE response_time_segments
  ADD CONSTRAINT response_time_segments_pass_limit CHECK (pass_index <= 200),
  ADD CONSTRAINT response_time_segments_seconds_limit CHECK (seconds <= 21600);

ALTER TABLE vocab_items
  ADD CONSTRAINT vocab_items_term_length CHECK (char_length(term) <= 100),
  ADD CONSTRAINT vocab_items_definition_length CHECK (char_length(definition) <= 600),
  ADD CONSTRAINT vocab_items_example_length CHECK (char_length(example) <= 800),
  ADD CONSTRAINT vocab_items_family_length CHECK (char_length(family) <= 200),
  ADD CONSTRAINT vocab_items_source_length CHECK (char_length(source) <= 120);

ALTER TABLE vocab_sets
  ADD CONSTRAINT vocab_sets_name_length CHECK (char_length(name) <= 120),
  ADD CONSTRAINT vocab_sets_description_length CHECK (char_length(description) <= 500);

ALTER TABLE vocab_set_items
  ADD CONSTRAINT vocab_set_items_display_term_length CHECK (char_length(COALESCE(display_term, '')) <= 100),
  ADD CONSTRAINT vocab_set_items_display_definition_length CHECK (char_length(COALESCE(display_definition, '')) <= 600),
  ADD CONSTRAINT vocab_set_items_display_example_length CHECK (char_length(COALESCE(display_example, '')) <= 800);

ALTER TABLE user_vocab_set_items
  ADD CONSTRAINT user_vocab_set_items_display_term_length CHECK (char_length(COALESCE(display_term, '')) <= 100),
  ADD CONSTRAINT user_vocab_set_items_display_definition_length CHECK (char_length(COALESCE(display_definition, '')) <= 600),
  ADD CONSTRAINT user_vocab_set_items_display_example_length CHECK (char_length(COALESCE(display_example, '')) <= 800);
