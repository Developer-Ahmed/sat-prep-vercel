EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT q.row_id
FROM question_catalog q
LEFT JOIN progress p ON p.user_id = :'user_id' AND p.row_id = q.row_id
WHERE q.subject = :'subject'
  AND q.pool = :'pool'
  AND q.source = 'peak1600'
  AND (p.status IS NULL OR p.status IN ('unanswered', 'skipped'))
ORDER BY random()
LIMIT 22;

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT q.row_id
FROM question_catalog q
JOIN progress p ON p.user_id = :'user_id' AND p.row_id = q.row_id
WHERE q.subject = :'subject'
  AND q.pool = :'pool'
  AND q.source = 'peak1600'
  AND p.status = 'incorrect'
LIMIT 22;

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT m.id, m.title, m.created_at, m.submitted_at
FROM test_modules m
JOIN test_sessions s ON s.user_id = m.user_id AND s.id = m.session_id
WHERE s.user_id = :'user_id'
  AND s.subject = :'subject'
  AND s.pool = :'pool'
ORDER BY m.created_at DESC
LIMIT 12;
