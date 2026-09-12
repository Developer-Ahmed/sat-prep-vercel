-- SVG markup cached before the sanitizer preserved official drawing styles can
-- render as a solid fill. This removes only derived content so it is refetched.
DELETE FROM question_content
WHERE data_json::text ~* '<svg';
