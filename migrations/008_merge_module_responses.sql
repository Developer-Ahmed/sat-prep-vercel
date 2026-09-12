ALTER TABLE module_questions
  ADD COLUMN answer text NOT NULL DEFAULT '',
  ADD COLUMN flagged boolean NOT NULL DEFAULT false,
  ADD COLUMN status text,
  ADD COLUMN is_correct boolean,
  ADD COLUMN time_spent_seconds integer NOT NULL DEFAULT 0,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT module_questions_status_valid
    CHECK (status IS NULL OR status IN ('unanswered', 'correct', 'incorrect', 'skipped')),
  ADD CONSTRAINT module_questions_result_consistent
    CHECK (
      (status IS NULL AND is_correct IS NULL)
      OR (status IN ('unanswered', 'skipped') AND is_correct IS NULL)
      OR (status = 'correct' AND is_correct)
      OR (status = 'incorrect' AND NOT is_correct)
    ),
  ADD CONSTRAINT module_questions_time_nonnegative CHECK (time_spent_seconds >= 0),
  ADD CONSTRAINT module_questions_answer_length CHECK (char_length(answer) <= 32),
  ADD CONSTRAINT module_questions_time_limit CHECK (time_spent_seconds <= 21600);

UPDATE module_questions AS mq
SET
  answer = mr.answer,
  flagged = mr.flagged,
  status = mr.status,
  is_correct = mr.is_correct,
  time_spent_seconds = mr.time_spent_seconds,
  updated_at = mr.updated_at
FROM module_responses AS mr
WHERE mr.user_id = mq.user_id
  AND mr.module_id = mq.module_id
  AND mr.row_id = mq.row_id;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM module_responses mr
    JOIN module_questions mq
      ON mq.user_id = mr.user_id
      AND mq.module_id = mr.module_id
      AND mq.row_id = mr.row_id
    WHERE mq.answer IS DISTINCT FROM mr.answer
      OR mq.flagged IS DISTINCT FROM mr.flagged
      OR mq.status IS DISTINCT FROM mr.status
      OR mq.is_correct IS DISTINCT FROM mr.is_correct
      OR mq.time_spent_seconds IS DISTINCT FROM mr.time_spent_seconds
      OR mq.updated_at IS DISTINCT FROM mr.updated_at
  ) THEN
    RAISE EXCEPTION 'Module response migration validation failed.';
  END IF;
END
$$;

ALTER TABLE response_time_segments
  DROP CONSTRAINT response_time_segments_user_id_module_id_row_id_fkey,
  ADD CONSTRAINT response_time_segments_module_question_fkey
    FOREIGN KEY (user_id, module_id, row_id)
    REFERENCES module_questions(user_id, module_id, row_id) ON DELETE CASCADE;

DROP POLICY module_responses_isolate_tenant ON module_responses;
DROP TABLE module_responses;
