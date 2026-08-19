import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "./database.js";
import { normalizeSubject, subjectConfig } from "./subjects.js";
import { ROOT_SEED, VOCAB_SEED } from "./vocab-data.js";
import { VOCAB_TERMS_SEED } from "./vocab-terms-data.js";
import { WORDS_ONLY_SEED } from "./words-only-data.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const rootDir = resolve(__dirname, "..");
const publicDir = join(rootDir, "public");
const dataDir = join(rootDir, "data");
const dbPath = join(dataDir, "satprep.db");
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 5174);

const MYSATPREP_BASE = "https://www.mysatprep.fun";
const SAT_MATH_LIST_URL = `${MYSATPREP_BASE}/api/get-questions?assessment=99&domains=H,P,Q,S`;
const LOOKUP_URL = `${MYSATPREP_BASE}/api/lookup`;
const COLLEGE_BOARD_BASE = "https://qbank-api.collegeboard.org/msreportingquestionbank-prod/questionbank";
const REALISTIC_MODULE_QUOTA_OPTIONS = [
  { "Algebra": 8, "Advanced Math": 8, "Problem-Solving and Data Analysis": 3, "Geometry and Trigonometry": 3 },
  { "Algebra": 8, "Advanced Math": 7, "Problem-Solving and Data Analysis": 4, "Geometry and Trigonometry": 3 },
  { "Algebra": 8, "Advanced Math": 7, "Problem-Solving and Data Analysis": 3, "Geometry and Trigonometry": 4 },
  { "Algebra": 7, "Advanced Math": 8, "Problem-Solving and Data Analysis": 4, "Geometry and Trigonometry": 3 },
  { "Algebra": 7, "Advanced Math": 8, "Problem-Solving and Data Analysis": 3, "Geometry and Trigonometry": 4 },
  { "Algebra": 7, "Advanced Math": 7, "Problem-Solving and Data Analysis": 4, "Geometry and Trigonometry": 4 }
];
const ENGLISH_REALISTIC_MODULE_QUOTA_OPTIONS = [
  { "Information and Ideas": 7, "Expression of Ideas": 5, "Craft and Structure": 8, "Standard English Conventions": 7 },
  { "Information and Ideas": 7, "Expression of Ideas": 6, "Craft and Structure": 7, "Standard English Conventions": 7 },
  { "Information and Ideas": 6, "Expression of Ideas": 5, "Craft and Structure": 8, "Standard English Conventions": 8 },
  { "Information and Ideas": 7, "Expression of Ideas": 4, "Craft and Structure": 8, "Standard English Conventions": 8 },
  { "Information and Ideas": 6, "Expression of Ideas": 6, "Craft and Structure": 8, "Standard English Conventions": 7 },
  { "Information and Ideas": 7, "Expression of Ideas": 5, "Craft and Structure": 7, "Standard English Conventions": 8 }
];

if (!process.env.TURSO_DATABASE_URL && !existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

const db = await openDatabase({ path: dbPath });
const shouldInitializeDatabase = !process.env.VERCEL || process.env.RUN_DATABASE_MIGRATIONS === "1";
let cacheJob = {
  running: false,
  total: 0,
  completed: 0,
  skipped: 0,
  failed: 0,
  current: "",
  error: "",
  startedAt: null,
  finishedAt: null
};
if (db.kind === "local") await db.exec("PRAGMA journal_mode = WAL;");
if (shouldInitializeDatabase) await db.exec(`
	  CREATE TABLE IF NOT EXISTS questions (
	    row_id TEXT PRIMARY KEY,
	    source TEXT NOT NULL DEFAULT 'mysatprep',
	    subject TEXT NOT NULL DEFAULT 'math',
	    pool TEXT NOT NULL DEFAULT 'main',
	    question_id TEXT,
    uid TEXT,
    external_id TEXT,
    ibn TEXT,
    program TEXT,
    domain TEXT,
    domain_desc TEXT,
    skill TEXT,
    skill_desc TEXT,
    difficulty TEXT,
    excluded_bluebook INTEGER NOT NULL DEFAULT 0,
    raw_json TEXT NOT NULL,
    imported_at TEXT NOT NULL
	  );
	  CREATE TABLE IF NOT EXISTS app_settings (
	    key TEXT PRIMARY KEY,
	    value TEXT NOT NULL
	  );
	  CREATE TABLE IF NOT EXISTS question_content (
    content_key TEXT PRIMARY KEY,
    data_json TEXT NOT NULL,
    fetched_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS progress (
    row_id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'unanswered',
    flagged INTEGER NOT NULL DEFAULT 0,
    selected_answer TEXT,
    answered_at TEXT,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(row_id) REFERENCES questions(row_id)
  );
	  CREATE TABLE IF NOT EXISTS modules (
	    id INTEGER PRIMARY KEY AUTOINCREMENT,
	    subject TEXT NOT NULL DEFAULT 'math',
	    pool TEXT NOT NULL DEFAULT 'main',
	    title TEXT NOT NULL,
	    question_ids TEXT NOT NULL,
	    duration_seconds INTEGER,
	    created_at TEXT NOT NULL,
	    submitted_at TEXT
	  );
  CREATE TABLE IF NOT EXISTS module_answers (
    module_id INTEGER NOT NULL,
    row_id TEXT NOT NULL,
    answer TEXT,
    flagged INTEGER NOT NULL DEFAULT 0,
    status TEXT,
    is_correct INTEGER,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(module_id, row_id),
    FOREIGN KEY(module_id) REFERENCES modules(id),
    FOREIGN KEY(row_id) REFERENCES questions(row_id)
	  );
  CREATE TABLE IF NOT EXISTS module_time_segments (
    module_id INTEGER NOT NULL,
    row_id TEXT NOT NULL,
    pass_index INTEGER NOT NULL,
    seconds INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(module_id, row_id, pass_index),
    FOREIGN KEY(module_id) REFERENCES modules(id),
    FOREIGN KEY(row_id) REFERENCES questions(row_id)
  );
	CREATE TABLE IF NOT EXISTS vocab_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL CHECK(kind IN ('word', 'root')),
    term TEXT NOT NULL,
    definition TEXT NOT NULL,
    example TEXT NOT NULL DEFAULT '',
    family TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'user',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    UNIQUE(kind, term)
  );
  CREATE TABLE IF NOT EXISTS vocab_sets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL CHECK(kind IN ('word', 'root')),
    built_in INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS vocab_set_items (
    set_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    added_at TEXT NOT NULL,
    PRIMARY KEY(set_id, item_id),
    FOREIGN KEY(set_id) REFERENCES vocab_sets(id),
    FOREIGN KEY(item_id) REFERENCES vocab_items(id)
  );
  CREATE TABLE IF NOT EXISTS vocab_progress (
    set_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    state TEXT NOT NULL DEFAULT 'new',
    due_at TEXT NOT NULL,
    interval_days INTEGER NOT NULL DEFAULT 0,
    streak INTEGER NOT NULL DEFAULT 0,
    lapses INTEGER NOT NULL DEFAULT 0,
    last_reviewed_at TEXT,
    PRIMARY KEY(set_id, item_id),
    FOREIGN KEY(set_id) REFERENCES vocab_sets(id),
    FOREIGN KEY(item_id) REFERENCES vocab_items(id)
  );
  CREATE TABLE IF NOT EXISTS vocab_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    set_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    rating TEXT NOT NULL,
    correct INTEGER NOT NULL,
    reviewed_at TEXT NOT NULL,
    FOREIGN KEY(set_id) REFERENCES vocab_sets(id),
    FOREIGN KEY(item_id) REFERENCES vocab_items(id)
  );
  CREATE INDEX IF NOT EXISTS idx_vocab_items_kind ON vocab_items(kind, active);
  CREATE INDEX IF NOT EXISTS idx_vocab_set_items_item ON vocab_set_items(item_id);
  CREATE INDEX IF NOT EXISTS idx_vocab_progress_due ON vocab_progress(due_at);
  CREATE INDEX IF NOT EXISTS idx_vocab_reviews_date ON vocab_reviews(reviewed_at);
	`);

async function ensureVocabularySet(slug, name, description, kind) {
  await db.prepare(`
    INSERT OR IGNORE INTO vocab_sets (slug, name, description, kind, built_in, active, created_at)
    VALUES (?, ?, ?, ?, 1, 1, ?)
  `).run(slug, name, description, kind, now());
  return (await db.prepare("SELECT id FROM vocab_sets WHERE slug = ?").get(slug)).id;
}

let originalVocabSetId;
let vocabTermsSetId;
let wordsOnlySetId;
let rootVocabSetId;

if (shouldInitializeDatabase) {
  const vocabSetItemColumns = (await db.prepare("PRAGMA table_info(vocab_set_items)").all()).map((column) => column.name);
  if (!vocabSetItemColumns.includes("display_term")) {
    await db.exec("ALTER TABLE vocab_set_items ADD COLUMN display_term TEXT");
  }

  originalVocabSetId = await ensureVocabularySet(
    "sat-vocabulary",
    "SAT Vocabulary",
    "Your original vocabulary collection",
    "word"
  );
  vocabTermsSetId = await ensureVocabularySet(
    "vocab-terms",
    "Vocab Terms",
    "Imported from vocab_terms.txt",
    "word"
  );
  wordsOnlySetId = await ensureVocabularySet(
    "words-only",
    "Words Only",
    "Imported from words_only.txt",
    "word"
  );
  rootVocabSetId = await ensureVocabularySet(
    "roots",
    "Roots",
    "High-utility Greek and Latin roots",
    "root"
  );
}

async function migrateVocabularyProgressToSets() {
  const progressColumns = (await db.prepare("PRAGMA table_info(vocab_progress)").all()).map((column) => column.name);
  if (!progressColumns.includes("set_id")) {
    await db.exec(`
      CREATE TABLE vocab_progress_with_sets (
        set_id INTEGER NOT NULL,
        item_id INTEGER NOT NULL,
        state TEXT NOT NULL DEFAULT 'new',
        due_at TEXT NOT NULL,
        interval_days INTEGER NOT NULL DEFAULT 0,
        streak INTEGER NOT NULL DEFAULT 0,
        lapses INTEGER NOT NULL DEFAULT 0,
        last_reviewed_at TEXT,
        PRIMARY KEY(set_id, item_id),
        FOREIGN KEY(set_id) REFERENCES vocab_sets(id),
        FOREIGN KEY(item_id) REFERENCES vocab_items(id)
      );
      INSERT INTO vocab_progress_with_sets (
        set_id, item_id, state, due_at, interval_days, streak, lapses, last_reviewed_at
      )
      SELECT CASE WHEN i.kind = 'root' THEN ${rootVocabSetId} ELSE ${originalVocabSetId} END,
        p.item_id, p.state, p.due_at, p.interval_days, p.streak, p.lapses, p.last_reviewed_at
      FROM vocab_progress p
      JOIN vocab_items i ON i.id = p.item_id;
      DROP TABLE vocab_progress;
      ALTER TABLE vocab_progress_with_sets RENAME TO vocab_progress;
    `);
  }

  const reviewColumns = (await db.prepare("PRAGMA table_info(vocab_reviews)").all()).map((column) => column.name);
  if (!reviewColumns.includes("set_id")) {
    await db.exec(`
      CREATE TABLE vocab_reviews_with_sets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        set_id INTEGER NOT NULL,
        item_id INTEGER NOT NULL,
        rating TEXT NOT NULL,
        correct INTEGER NOT NULL,
        reviewed_at TEXT NOT NULL,
        FOREIGN KEY(set_id) REFERENCES vocab_sets(id),
        FOREIGN KEY(item_id) REFERENCES vocab_items(id)
      );
      INSERT INTO vocab_reviews_with_sets (id, set_id, item_id, rating, correct, reviewed_at)
      SELECT r.id, CASE WHEN i.kind = 'root' THEN ${rootVocabSetId} ELSE ${originalVocabSetId} END,
        r.item_id, r.rating, r.correct, r.reviewed_at
      FROM vocab_reviews r
      JOIN vocab_items i ON i.id = r.item_id;
      DROP TABLE vocab_reviews;
      ALTER TABLE vocab_reviews_with_sets RENAME TO vocab_reviews;
    `);
  }

  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_vocab_progress_due ON vocab_progress(set_id, due_at);
    CREATE INDEX IF NOT EXISTS idx_vocab_reviews_date ON vocab_reviews(set_id, reviewed_at);
  `);
}

if (shouldInitializeDatabase) {
  await migrateVocabularyProgressToSets();

  await db.prepare(`
    INSERT OR IGNORE INTO vocab_set_items (set_id, item_id, position, added_at, display_term)
    SELECT ?, id, id, ?, term FROM vocab_items
    WHERE kind = 'word' AND source = 'quizlet-user-list'
  `).run(originalVocabSetId, now());
  await db.prepare(`
    INSERT OR IGNORE INTO vocab_set_items (set_id, item_id, position, added_at, display_term)
    SELECT ?, id, id, ?, term FROM vocab_items WHERE kind = 'root'
  `).run(rootVocabSetId, now());

  const moduleColumns = await db.prepare("PRAGMA table_info(modules)").all();
  const normalizedModuleColumns = moduleColumns.map((column) => column.name);
  if (!normalizedModuleColumns.includes("kind")) {
    await db.exec("ALTER TABLE modules ADD COLUMN kind TEXT NOT NULL DEFAULT 'practice'");
  }
  if (!normalizedModuleColumns.includes("subject")) {
    await db.exec("ALTER TABLE modules ADD COLUMN subject TEXT NOT NULL DEFAULT 'math'");
  }
  if (!normalizedModuleColumns.includes("pool")) {
    await db.exec("ALTER TABLE modules ADD COLUMN pool TEXT NOT NULL DEFAULT 'main'");
  }
  if (!normalizedModuleColumns.includes("section_id")) {
    await db.exec("ALTER TABLE modules ADD COLUMN section_id TEXT");
  }
  if (!normalizedModuleColumns.includes("section_order")) {
    await db.exec("ALTER TABLE modules ADD COLUMN section_order INTEGER");
  }

  const answerColumns = await db.prepare("PRAGMA table_info(module_answers)").all();
  const normalizedAnswerColumns = answerColumns.map((column) => column.name);
  if (!normalizedAnswerColumns.includes("time_spent_seconds")) {
    await db.exec("ALTER TABLE module_answers ADD COLUMN time_spent_seconds INTEGER NOT NULL DEFAULT 0");
  }

  const questionColumns = await db.prepare("PRAGMA table_info(questions)").all();
  const normalizedQuestionColumns = questionColumns.map((column) => column.name);
  if (!normalizedQuestionColumns.includes("source")) {
    await db.exec("ALTER TABLE questions ADD COLUMN source TEXT NOT NULL DEFAULT 'mysatprep'");
  }
  if (!normalizedQuestionColumns.includes("subject")) {
    await db.exec("ALTER TABLE questions ADD COLUMN subject TEXT NOT NULL DEFAULT 'math'");
  }
  if (!normalizedQuestionColumns.includes("pool")) {
    await db.exec("ALTER TABLE questions ADD COLUMN pool TEXT NOT NULL DEFAULT 'main'");
  }
  await db.exec(`
    UPDATE modules
    SET kind = 'review_incorrect'
    WHERE title LIKE 'Incorrect question review%';
    UPDATE modules
    SET kind = 'review_flagged'
    WHERE title LIKE 'Flagged question review%';
  `);
}

const insertQuestion = db.prepare(`
  INSERT INTO questions (
    row_id, source, subject, pool, question_id, uid, external_id, ibn, program, domain, domain_desc,
    skill, skill_desc, difficulty, excluded_bluebook, raw_json, imported_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(row_id) DO UPDATE SET
    source = excluded.source,
    subject = excluded.subject,
    pool = excluded.pool,
    question_id = excluded.question_id,
    uid = excluded.uid,
    external_id = excluded.external_id,
    ibn = excluded.ibn,
    program = excluded.program,
    domain = excluded.domain,
    domain_desc = excluded.domain_desc,
    skill = excluded.skill,
    skill_desc = excluded.skill_desc,
    difficulty = excluded.difficulty,
    excluded_bluebook = excluded.excluded_bluebook,
    raw_json = excluded.raw_json,
    imported_at = excluded.imported_at
`);

function now() {
  return new Date().toISOString();
}

async function seedVocabulary() {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO vocab_items (
      kind, term, definition, example, family, source, active, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
  `);
  const addToSet = db.prepare(`
    INSERT INTO vocab_set_items (set_id, item_id, position, added_at, display_term)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(set_id, item_id) DO UPDATE SET
      position = excluded.position,
      display_term = excluded.display_term
  `);
  const findItem = db.prepare("SELECT id FROM vocab_items WHERE kind = ? AND term = ? COLLATE NOCASE");
  const updateImportedDefinition = db.prepare(`
    UPDATE vocab_items
    SET definition = ?
    WHERE kind = 'word' AND term = ? COLLATE NOCASE AND source = ?
  `);
  const createdAt = now();
  await db.transaction(async (tx) => {
    const txInsert = tx.prepare(insert.sourceSQL);
    const txAddToSet = tx.prepare(addToSet.sourceSQL);
    const txFindItem = tx.prepare(findItem.sourceSQL);
    const txUpdateImportedDefinition = tx.prepare(updateImportedDefinition.sourceSQL);
    for (const [position, [term, definition, example]] of VOCAB_SEED.entries()) {
      await txInsert.run("word", term, definition, example, "", "quizlet-user-list", createdAt);
      await txAddToSet.run(originalVocabSetId, (await txFindItem.get("word", term)).id, position, createdAt, term);
    }
    for (const [position, [term, definition, family, origin]] of ROOT_SEED.entries()) {
      await txInsert.run("root", term, definition, `Word family: ${family}`, family, origin, createdAt);
      await txAddToSet.run(rootVocabSetId, (await txFindItem.get("root", term)).id, position, createdAt, term);
    }
    for (const [position, [term, definition, example = ""]] of VOCAB_TERMS_SEED.entries()) {
      await txInsert.run("word", term, definition, example, "", "vocab-terms-file", createdAt);
      await txUpdateImportedDefinition.run(definition, term, "vocab-terms-file");
      await txAddToSet.run(vocabTermsSetId, (await txFindItem.get("word", term)).id, position, createdAt, term);
    }
    await tx.prepare("DELETE FROM vocab_set_items WHERE set_id = ?").run(wordsOnlySetId);
    for (const [position, [term, definition, example = ""]] of WORDS_ONLY_SEED.entries()) {
      if (!(await txFindItem.get("word", term))) {
        await txInsert.run("word", term, definition, example, "", "words-only-file", createdAt);
      }
      await txUpdateImportedDefinition.run(definition, term, "words-only-file");
      await txAddToSet.run(wordsOnlySetId, (await txFindItem.get("word", term)).id, position, createdAt, term);
    }
  });
}

if (shouldInitializeDatabase && !(await db.prepare("SELECT 1 FROM app_settings WHERE key = 'vocab_seed_version_2026_08' LIMIT 1").get())) {
  await seedVocabulary();
  await db.prepare("INSERT INTO app_settings (key, value) VALUES ('vocab_seed_version_2026_08', ?)").run(now());
}

if (shouldInitializeDatabase && !(await db.prepare("SELECT 1 FROM app_settings WHERE key = 'vocab_set_membership_cleanup_v1'").get())) {
  await db.prepare(`
    DELETE FROM vocab_set_items
    WHERE set_id = ?
      AND item_id IN (SELECT id FROM vocab_items WHERE source = 'vocab-terms-file')
  `).run(originalVocabSetId);
  await db.prepare("INSERT INTO app_settings (key, value) VALUES ('vocab_set_membership_cleanup_v1', ?)").run(now());
}

if (shouldInitializeDatabase && !(await db.prepare("SELECT 1 FROM app_settings WHERE key = 'words_only_membership_cleanup_v1'").get())) {
  await db.prepare(`
    DELETE FROM vocab_set_items
    WHERE set_id = ?
      AND item_id IN (SELECT id FROM vocab_items WHERE source = 'words-only-file')
  `).run(originalVocabSetId);
  await db.prepare("INSERT INTO app_settings (key, value) VALUES ('words_only_membership_cleanup_v1', ?)").run(now());
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload)
  });
  res.end(payload);
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

function rowIdFor(question, subject = "math") {
  const source = question.source || "mysatprep";
  const id = question.rowIdBase || question.questionId || question.uId || question.ibn || question.external_id;
  const base = `${source}:${id}`;
  return normalizeSubject(subject) === "math" ? base : `${normalizeSubject(subject)}:${base}`;
}

function contentKeyFor(question) {
  const source = question.source || "mysatprep";
  return `${source}:${question.external_id || question.ibn || question.row_id}`;
}

function contentIsUsable(question, content) {
  if (!content) return false;
  const hasPrompt = Boolean(content.stem || content.stimulus);
  const hasCorrectAnswer = Array.isArray(content.correct_answer) && content.correct_answer.length > 0;
  if (question.source === "collegeboard") return hasPrompt && hasCorrectAnswer;
  return hasPrompt;
}

async function cachedContentFor(question) {
  const cached = await db
    .prepare("SELECT data_json FROM question_content WHERE content_key = ?")
    .get(contentKeyFor(question));
  if (!cached) return null;
  try {
    return normalizeContentCorrectAnswers(JSON.parse(cached.data_json));
  } catch {
    return null;
  }
}

function isAnsweredStatus(status) {
  return status === "correct" || status === "incorrect";
}

function subjectFromUrl(url) {
  return normalizeSubject(url.searchParams.get("subject"));
}

function subjectFromBody(body) {
  return normalizeSubject(body?.subject);
}

function normalizePool(value) {
  return value === "new" ? "new" : "main";
}

function poolFromUrl(url) {
  return normalizePool(url.searchParams.get("pool"));
}

function poolFromBody(body) {
  return normalizePool(body?.pool);
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      "accept": "application/json",
      "user-agent": "sat-prep-local-app/1.0"
    }
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} from ${url}`);
  }
  return response.json();
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "accept": "application/json",
      "content-type": "application/json",
      "user-agent": "sat-prep-local-app/1.0"
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} from ${url}`);
  }
  return response.json();
}

async function getSetting(key, fallback = "") {
  return (await db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key))?.value || fallback;
}

async function setSetting(key, value, database = db) {
  await database.prepare(`
    INSERT INTO app_settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

function sourceLabel(source) {
  return source === "collegeboard" ? "College Board official" : "MySATPrep row pool";
}

async function activeSourceFor(subject = "math", pool = "main") {
  const subjectKey = normalizeSubject(subject);
  const poolKey = normalizePool(pool);
  const legacy = await getSetting("activeSource", "collegeboard");
  const subjectSource = await getSetting(`activeSource:${subjectKey}`, legacy);
  return getSetting(`activeSource:${subjectKey}:${poolKey}`, subjectSource);
}

async function getQuestion(rowId) {
  return await db
    .prepare(`
      SELECT q.*, p.status, p.flagged, p.selected_answer, p.answered_at
      FROM questions q
      LEFT JOIN progress p ON p.row_id = q.row_id
      WHERE q.row_id = ?
    `)
    .get(rowId);
}

async function getQuestionContent(question) {
  const contentKey = contentKeyFor(question);
  const cached = await db
    .prepare("SELECT data_json FROM question_content WHERE content_key = ?")
    .get(contentKey);
  if (cached) {
    const content = JSON.parse(cached.data_json);
    const needsLegacyRefresh =
      question.source === "collegeboard" &&
      question.ibn &&
      (!content.stimulus || !(Array.isArray(content.correct_answer) && content.correct_answer.length));
    if (!needsLegacyRefresh && contentIsUsable(question, content)) return normalizeContentCorrectAnswers(content);
  }

  const source = question.source || "mysatprep";
  const rawKey = question.external_id || question.ibn || question.question_id || question.row_id.split(":").pop();
  let content;

  if (source === "collegeboard") {
    content = question.external_id
      ? normalizeCollegeBoardDigitalQuestion(
          await postJson(`${COLLEGE_BOARD_BASE}/digital/get-question`, { external_id: question.external_id })
        )
      : normalizeCollegeBoardLegacyQuestion(
          (await fetchJson(`https://saic.collegeboard.org/disclosed/${encodeURIComponent(question.ibn)}.json`))[0]
        );
  } else {
    const data = await fetchJson(`${MYSATPREP_BASE}/api/question/${encodeURIComponent(rawKey)}`);
    if (!data.success || !data.data) {
      throw new Error(`No question content returned for ${rawKey}`);
    }
    content = data.data;
  }

  await db.prepare(`
    INSERT INTO question_content (content_key, data_json, fetched_at)
    VALUES (?, ?, ?)
    ON CONFLICT(content_key) DO UPDATE SET
      data_json = excluded.data_json,
      fetched_at = excluded.fetched_at
  `).run(contentKey, JSON.stringify(content), now());

  return content;
}

function normalizeCollegeBoardDigitalQuestion(question) {
  const answerOptions = Array.isArray(question.answerOptions) && question.answerOptions.length
    ? Object.fromEntries(
        question.answerOptions.map((option, index) => [
          String.fromCharCode(65 + index),
          option.content || option.body || String(option)
        ])
      )
    : undefined;

  return {
    answerOptions,
    correct_answer: question.correct_answer || [],
    rationale: question.rationale || "",
    stem: question.stem || "",
    stimulus: question.stimulus || "",
    type: question.type || "",
    externalid: question.externalid || ""
  };
}

function htmlToText(html) {
  return String(html || "")
    .replace(/<img\b[^>]*\balt=["']([^"']+)["'][^>]*>/gi, " $1 ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&rsquo;/g, "'")
    .replace(/&ldquo;/g, "\"")
    .replace(/&rdquo;/g, "\"")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function wordsToMathAnswer(value) {
  return String(value || "")
    .replace(/\bthe fraction\s+(-?(?:\d+(?:\.\d*)?|\.\d+))\s+over\s+(-?(?:\d+(?:\.\d*)?|\.\d+))\b/gi, "$1/$2")
    .replace(/\b(-?(?:\d+(?:\.\d*)?|\.\d+))\s+over\s+(-?(?:\d+(?:\.\d*)?|\.\d+))\b/gi, "$1/$2")
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(half|halves|thirds?|fourths?|quarters?|fifths?|sixths?|sevenths?|eighths?|ninths?|tenths?|elevenths?|twelfths?)\b/gi, (_, numerator, denominator) => {
      const numerators = {
        one: 1,
        two: 2,
        three: 3,
        four: 4,
        five: 5,
        six: 6,
        seven: 7,
        eight: 8,
        nine: 9,
        ten: 10,
        eleven: 11,
        twelve: 12
      };
      const denominators = {
        half: 2,
        halves: 2,
        third: 3,
        thirds: 3,
        fourth: 4,
        fourths: 4,
        quarter: 4,
        quarters: 4,
        fifth: 5,
        fifths: 5,
        sixth: 6,
        sixths: 6,
        seventh: 7,
        sevenths: 7,
        eighth: 8,
        eighths: 8,
        ninth: 9,
        ninths: 9,
        tenth: 10,
        tenths: 10,
        eleventh: 11,
        elevenths: 11,
        twelfth: 12,
        twelfths: 12
      };
      return `${numerators[numerator.toLowerCase()]}/${denominators[denominator.toLowerCase()]}`;
    })
    .replace(/\beither\b/gi, " ")
    .replace(/\bor\b/gi, " ")
    .trim();
}

function cleanCorrectAnswer(value) {
  return wordsToMathAnswer(value)
    .replace(/\s+/g, " ")
    .replace(/[.;:,]+$/g, "")
    .trim();
}

function deriveLegacyCorrectAnswers(answer) {
  const explicit = answer?.correct_choice || answer?.correctChoice || answer?.correct_answer || answer?.correctAnswer;
  if (Array.isArray(explicit)) return explicit.map(cleanCorrectAnswer).filter(Boolean);
  if (explicit) return [cleanCorrectAnswer(explicit).toUpperCase()].filter(Boolean);

  const rationale = htmlToText(answer?.rationale);
  const choiceMatch = rationale.match(/\bChoice\s+([A-D])\s+is\s+correct\b/i);
  if (choiceMatch) return [choiceMatch[1].toUpperCase()];

  const sprMatch = rationale.match(/\bThe\s+correct\s+answer\s+is\s+(.+?)(?:\.\s+[A-Z]|$)/i);
  if (!sprMatch) return [];
  return sprMatch[1]
    .split(/\s+or\s+|,\s*/i)
    .map(cleanCorrectAnswer)
    .filter(Boolean);
}

function normalizeCollegeBoardLegacyQuestion(question) {
  const choices = question?.answer?.choices || {};
  const answerOptions = Object.fromEntries(
    Object.entries(choices).map(([letter, choice]) => [letter.toUpperCase(), choice.body || ""])
  );
  const correctAnswers = deriveLegacyCorrectAnswers(question?.answer);

  return {
    answerOptions: Object.keys(answerOptions).length ? answerOptions : undefined,
    correct_answer: correctAnswers,
    rationale: question?.answer?.rationale || "",
    stem: question?.prompt || "",
    stimulus: question?.body || "",
    type: question?.answer?.style || "",
    ibn: question?.item_id || ""
  };
}

function normalizeAnswer(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function parseNumericAnswer(value) {
  const normalized = normalizeAnswer(value).replaceAll(",", "");
  if (/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized)) {
    return Number(normalized);
  }
  const fraction = normalized.match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\/([+-]?(?:\d+(?:\.\d+)?|\.\d+))$/);
  if (!fraction) return null;
  const numerator = Number(fraction[1]);
  const denominator = Number(fraction[2]);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
  return numerator / denominator;
}

function answersMatch(answer, candidate) {
  const normalizedAnswer = normalizeAnswer(answer);
  const normalizedCandidate = normalizeAnswer(cleanCorrectAnswer(candidate));
  if (normalizedAnswer === normalizedCandidate) return true;

  const answerNumber = parseNumericAnswer(normalizedAnswer);
  const candidateNumber = parseNumericAnswer(normalizedCandidate);
  if (answerNumber === null || candidateNumber === null) return false;
  if (Math.abs(answerNumber - candidateNumber) < 1e-9) return true;
  return decimalEntryMatches(normalizedAnswer, answerNumber, candidateNumber);
}

function deriveCorrectAnswersFromRationale(rationale) {
  const text = htmlToText(rationale);
  const sprMatch = text.match(/\bThe\s+correct\s+answer\s+is\s+(.+?)(?:\.\s+[A-Z]|$)/i);
  if (!sprMatch) return [];
  return sprMatch[1]
    .split(/\s+or\s+|,\s*/i)
    .map(cleanCorrectAnswer)
    .filter(Boolean);
}

function decimalEntryMatches(normalizedAnswer, answerNumber, candidateNumber) {
  const decimalMatch = normalizedAnswer.match(/^[+-]?(?:\d*)\.(\d+)$/);
  if (!decimalMatch || decimalMatch[1].length < 3) return false;
  const places = decimalMatch[1].length;
  const factor = 10 ** places;
  const truncated = candidateNumber < 0
    ? Math.ceil(candidateNumber * factor) / factor
    : Math.floor(candidateNumber * factor) / factor;
  const rounded = Math.round(candidateNumber * factor) / factor;
  return Math.abs(answerNumber - truncated) < 1e-9 || Math.abs(answerNumber - rounded) < 1e-9;
}

function gradeAnswer(content, answer) {
  if (!answer || !String(answer).trim()) {
    return { status: "skipped", isCorrect: null };
  }
  const correctAnswers = correctAnswersForContent(content);
  const isCorrect = correctAnswers.some((candidate) => answersMatch(answer, candidate));
  return { status: isCorrect ? "correct" : "incorrect", isCorrect };
}

function correctAnswersForContent(content) {
  const answers = [
    ...(Array.isArray(content?.correct_answer) ? content.correct_answer : []),
    ...deriveCorrectAnswersFromRationale(content?.rationale)
  ]
    .map(cleanCorrectAnswer)
    .filter((answer) => answer && !/^(?:either|or)$/i.test(answer));
  return [...new Set(answers)];
}

function normalizeContentCorrectAnswers(content) {
  return {
    ...content,
    correct_answer: correctAnswersForContent(content)
  };
}

async function clearQuestionPool(subject = "math", pool = "main", database = db) {
  const key = normalizeSubject(subject);
  const poolKey = normalizePool(pool);
  await database.prepare(`
    DELETE FROM module_time_segments
    WHERE module_id IN (SELECT id FROM modules WHERE subject = ? AND pool = ?)
  `).run(key, poolKey);
  await database.prepare(`
    DELETE FROM module_answers
    WHERE module_id IN (SELECT id FROM modules WHERE subject = ? AND pool = ?)
  `).run(key, poolKey);
  await database.prepare("DELETE FROM modules WHERE subject = ? AND pool = ?").run(key, poolKey);
  await database.prepare(`
    DELETE FROM progress
    WHERE row_id IN (SELECT row_id FROM questions WHERE subject = ? AND pool = ?)
  `).run(key, poolKey);
  await database.prepare("DELETE FROM questions WHERE subject = ? AND pool = ?").run(key, poolKey);
}

async function loadMySatPrepImportData() {
  const [questionResponse, lookupResponse] = await Promise.all([
    fetchJson(SAT_MATH_LIST_URL),
    fetchJson(LOOKUP_URL)
  ]);

  if (!questionResponse.success || !Array.isArray(questionResponse.data)) {
    throw new Error("MySATPrep question list response was not usable.");
  }
  return {
    source: "mysatprep",
    questions: questionResponse.data.map((question) => ({
      ...question,
      source: "mysatprep",
      rowIdBase: question.questionId || question.uId || question.ibn || question.external_id
    })),
    live: new Set(lookupResponse?.data?.mathLiveItems || [])
  };
}

async function loadCollegeBoardImportData(subject = "math") {
  const config = subjectConfig(subject);
  const [questionResponse, lookupResponse] = await Promise.all([
    postJson(`${COLLEGE_BOARD_BASE}/digital/get-questions`, {
      asmtEventId: 99,
      test: config.test,
      domain: config.domains
    }),
    fetchJson(`${COLLEGE_BOARD_BASE}/lookup`)
  ]);

  if (!Array.isArray(questionResponse)) {
    throw new Error("College Board question list response was not usable.");
  }

  const seen = new Set();
  const questions = [];
  for (const question of questionResponse) {
    const canonical = question.external_id || question.ibn || question.questionId;
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    questions.push({
      ...question,
      source: "collegeboard",
      rowIdBase: canonical
    });
  }

  return {
    source: "collegeboard",
    questions,
    live: new Set(lookupResponse?.[config.liveItemsKey] || [])
  };
}

function canonicalQuestionId(question) {
  return String(question.external_id || question.ibn || question.questionId || question.question_id || "").trim();
}

async function existingCollegeBoardCanonicals(subject = "math") {
  return new Set(
    (await db
      .prepare(`
        SELECT COALESCE(NULLIF(external_id, ''), NULLIF(ibn, ''), NULLIF(question_id, '')) AS canonical
        FROM questions
        WHERE source = 'collegeboard'
          AND subject = ?
      `)
      .all(normalizeSubject(subject)))
      .map((row) => row.canonical)
      .filter(Boolean)
  );
}

async function importNewQuestions(subject = "math") {
  const subjectKey = normalizeSubject(subject);
  const importData = await loadCollegeBoardImportData(subjectKey);
  const existing = await existingCollegeBoardCanonicals(subjectKey);
  const importedAt = now();
  const newQuestions = importData.questions.filter((question) => {
    const canonical = canonicalQuestionId(question);
    return canonical && !existing.has(canonical) && !importData.live.has(canonical);
  });

  await db.transaction(async (tx) => {
    const txInsertQuestion = tx.prepare(insertQuestion.sourceSQL);
    for (const question of newQuestions) {
      const rowId = rowIdFor(question, subjectKey);
      const externalId = question.external_id || "";
      await txInsertQuestion.run(
        rowId,
        importData.source,
        subjectKey,
        "new",
        question.questionId || "",
        question.uId || "",
        externalId,
        question.ibn || "",
        question.program || "",
        question.primary_class_cd || "",
        question.primary_class_cd_desc || "",
        question.skill_cd || "",
        question.skill_desc || "",
        question.difficulty || "",
        0,
        JSON.stringify(question),
        importedAt
      );
    }
    await setSetting(`activeSource:${subjectKey}:new`, importData.source, tx);
  });

  return {
    ...(await getStatus(subjectKey, "new")),
    importedNew: newQuestions.length
  };
}

async function importQuestions(source = "mysatprep", subject = "math", pool = "main") {
  const subjectKey = normalizeSubject(subject);
  const poolKey = normalizePool(pool);
  const sourceKey = source === "collegeboard" ? "collegeboard" : "mysatprep";
  if (subjectKey === "english" && sourceKey !== "collegeboard") {
    throw new Error("English currently uses the College Board official import only.");
  }
  const importData = sourceKey === "collegeboard"
    ? await loadCollegeBoardImportData(subjectKey)
    : await loadMySatPrepImportData();

  const importedAt = now();
  await db.transaction(async (tx) => {
    const txInsertQuestion = tx.prepare(insertQuestion.sourceSQL);
    await clearQuestionPool(subjectKey, poolKey, tx);
    for (const question of importData.questions) {
      const rowId = rowIdFor(question, subjectKey);
      const externalId = question.external_id || "";
      await txInsertQuestion.run(
        rowId,
        importData.source,
        subjectKey,
        poolKey,
        question.questionId || "",
        question.uId || "",
        externalId,
        question.ibn || "",
        question.program || "",
        question.primary_class_cd || "",
        question.primary_class_cd_desc || "",
        question.skill_cd || "",
        question.skill_desc || "",
        question.difficulty || "",
        externalId && importData.live.has(externalId) ? 1 : 0,
        JSON.stringify(question),
        importedAt
      );
    }
    await setSetting(`activeSource:${subjectKey}:${poolKey}`, importData.source, tx);
  });

  return getStatus(subjectKey, poolKey);
}

async function getAvailableCollegeBoardQuestions(subject = "math", pool = "main") {
  return await db
    .prepare(`
      SELECT q.*
      FROM questions q
      WHERE q.source = 'collegeboard'
        AND q.subject = ?
        AND q.pool = ?
        AND q.excluded_bluebook = 0
      ORDER BY q.row_id
    `)
    .all(normalizeSubject(subject), normalizePool(pool));
}

async function getContentCacheStats(subject = "math", pool = "main") {
  const stats = await db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(
        CASE
          WHEN qc.content_key IS NOT NULL
            AND json_valid(qc.data_json) = 1
            AND (
              COALESCE(json_extract(qc.data_json, '$.stem'), '') <> ''
              OR COALESCE(json_extract(qc.data_json, '$.stimulus'), '') <> ''
            )
            AND json_array_length(qc.data_json, '$.correct_answer') > 0
          THEN 1
          ELSE 0
        END
      ) AS cached
    FROM questions q
    LEFT JOIN question_content qc
      ON qc.content_key = q.source || ':' || COALESCE(NULLIF(q.external_id, ''), NULLIF(q.ibn, ''), q.row_id)
    WHERE q.source = 'collegeboard'
      AND q.subject = ?
      AND q.pool = ?
      AND q.excluded_bluebook = 0
  `).get(normalizeSubject(subject), normalizePool(pool));
  const cached = Number(stats.cached || 0);
  const total = Number(stats.total || 0);
  return {
    cached,
    total,
    remaining: Math.max(0, total - cached)
  };
}

async function publicCacheJob(subject = "math", pool = "main") {
  return {
    ...cacheJob,
    cache: await getContentCacheStats(subject, pool)
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runCacheAllQuestions(subject = "math", pool = "main") {
  const subjectKey = normalizeSubject(subject);
  const poolKey = normalizePool(pool);
  cacheJob = {
    running: true,
    total: 0,
    completed: 0,
    skipped: 0,
    failed: 0,
    current: "",
    error: "",
    startedAt: now(),
    finishedAt: null
  };

  const questions = await getAvailableCollegeBoardQuestions(subjectKey, poolKey);
  cacheJob.total = questions.length;

  for (const question of questions) {
    cacheJob.current = question.question_id || question.row_id;
    if (contentIsUsable(question, await cachedContentFor(question))) {
      cacheJob.skipped += 1;
      cacheJob.completed += 1;
      continue;
    }

    try {
      await getQuestionContent(question);
    } catch (error) {
      cacheJob.failed += 1;
      cacheJob.error = `${cacheJob.current}: ${error.message || error}`;
    }
    cacheJob.completed += 1;
    await wait(60);
  }

  cacheJob.running = false;
  cacheJob.current = "";
  cacheJob.finishedAt = now();
}

async function startCacheAllQuestions(subject = "math", pool = "main") {
  if (process.env.VERCEL) {
    throw new Error("Bulk background caching is not available on Vercel. Questions will be cached automatically when you open them.");
  }
  const subjectKey = normalizeSubject(subject);
  const poolKey = normalizePool(pool);
  if (!(await getAvailableCollegeBoardQuestions(subjectKey, poolKey)).length) {
    throw new Error("Import College Board questions before caching full content.");
  }
  if (!cacheJob.running) {
    runCacheAllQuestions(subjectKey, poolKey).catch((error) => {
      cacheJob.running = false;
      cacheJob.error = error.message || String(error);
      cacheJob.finishedAt = now();
    });
  }
  return publicCacheJob(subjectKey, poolKey);
}

async function getStatus(subject = "math", pool = "main") {
  const subjectKey = normalizeSubject(subject);
  const poolKey = normalizePool(pool);
  const counts = await db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN excluded_bluebook = 1 THEN 1 ELSE 0 END) AS excluded,
      SUM(CASE WHEN excluded_bluebook = 0 THEN 1 ELSE 0 END) AS available,
      SUM(CASE WHEN excluded_bluebook = 0 AND (p.status IS NULL OR p.status IN ('unanswered', 'skipped')) THEN 1 ELSE 0 END) AS unanswered,
      SUM(CASE WHEN excluded_bluebook = 0 AND p.status IN ('correct', 'incorrect') THEN 1 ELSE 0 END) AS answered,
      SUM(CASE WHEN excluded_bluebook = 0 AND p.status = 'correct' THEN 1 ELSE 0 END) AS correct,
      SUM(CASE WHEN excluded_bluebook = 0 AND p.status = 'incorrect' THEN 1 ELSE 0 END) AS incorrect,
      SUM(CASE WHEN excluded_bluebook = 0 AND COALESCE(p.flagged, 0) = 1 THEN 1 ELSE 0 END) AS flagged
    FROM questions q
    LEFT JOIN progress p ON p.row_id = q.row_id
    WHERE q.subject = ?
      AND q.pool = ?
  `).get(subjectKey, poolKey);

  const lastImport = await db
    .prepare("SELECT MAX(imported_at) AS imported_at FROM questions WHERE subject = ? AND pool = ?")
    .get(subjectKey, poolKey);
  const contentCache = await getContentCacheStats(subjectKey, poolKey);
  const performanceRows = await db
    .prepare(`
      SELECT
        COALESCE(NULLIF(TRIM(q.domain_desc), ''), 'Math') AS domain,
        COALESCE(NULLIF(TRIM(q.skill_desc), ''), 'Uncategorized') AS skill,
        COUNT(*) AS total,
        SUM(CASE WHEN p.status = 'correct' THEN 1 ELSE 0 END) AS correct,
        SUM(CASE WHEN p.status = 'incorrect' THEN 1 ELSE 0 END) AS incorrect,
        SUM(CASE WHEN p.status IN ('correct', 'incorrect') THEN 1 ELSE 0 END) AS answered
      FROM questions q
      LEFT JOIN progress p ON p.row_id = q.row_id
      WHERE q.excluded_bluebook = 0
        AND q.subject = ?
        AND q.pool = ?
      GROUP BY domain, skill
      ORDER BY domain, skill
    `)
    .all(subjectKey, poolKey);
  const performanceByDomain = Object.values(
    performanceRows.reduce((domains, row) => {
      const domain = row.domain || "Math";
      if (!domains[domain]) {
        domains[domain] = {
          domain,
          correct: 0,
          incorrect: 0,
          answered: 0,
          total: 0,
          skills: []
        };
      }
      const skill = {
        skill: row.skill || "Uncategorized",
        total: row.total || 0,
        correct: row.correct || 0,
        incorrect: row.incorrect || 0,
        answered: row.answered || 0
      };
      domains[domain].correct += skill.correct;
      domains[domain].incorrect += skill.incorrect;
      domains[domain].answered += skill.answered;
      domains[domain].total += skill.total;
      domains[domain].skills.push(skill);
      return domains;
    }, {})
  ).sort((a, b) => a.domain.localeCompare(b.domain));

  const activeSource = await activeSourceFor(subjectKey, poolKey);
  return {
    ...counts,
    total: counts.total || 0,
    excluded: counts.excluded || 0,
    available: counts.available || 0,
    unanswered: counts.unanswered || 0,
    answered: counts.answered || 0,
    correct: counts.correct || 0,
    incorrect: counts.incorrect || 0,
    flagged: counts.flagged || 0,
    subject: subjectKey,
    pool: poolKey,
    activeSource,
    activeSourceLabel: sourceLabel(activeSource),
    lastImport: lastImport.imported_at || null,
    contentCache,
    performanceByDomain,
    dbPath
  };
}

async function selectRows(where, limit, subject = "math", pool = "main") {
  return await db
    .prepare(`
      SELECT row_id, domain_desc, skill_desc
      FROM (
        SELECT
          q.row_id,
          q.domain_desc,
          q.skill_desc,
          ROW_NUMBER() OVER (
            PARTITION BY COALESCE(NULLIF(q.external_id, ''), NULLIF(q.ibn, ''), q.row_id)
            ORDER BY random()
          ) AS duplicate_rank
        FROM questions q
        LEFT JOIN progress p ON p.row_id = q.row_id
        WHERE q.subject = ?
          AND q.pool = ?
          AND ${where}
      )
      WHERE duplicate_rank = 1
      ORDER BY random()
      LIMIT ?
    `)
    .all(normalizeSubject(subject), normalizePool(pool), limit);
}

async function dedupeKeysForRowIds(rowIds) {
  if (!rowIds.length) return [];
  return (await db
    .prepare(`
      SELECT DISTINCT COALESCE(NULLIF(external_id, ''), NULLIF(ibn, ''), row_id) AS dedupe_key
      FROM questions
      WHERE row_id IN (${rowIds.map(() => "?").join(",")})
    `)
    .all(...rowIds))
    .map((row) => row.dedupe_key)
    .filter(Boolean);
}

async function selectCollegeBoardDomainRows(domain, limit, excludedRowIds = [], subject = "math", pool = "main") {
  const excludedKeys = await dedupeKeysForRowIds(excludedRowIds);
  const excludeClause = excludedKeys.length
    ? `AND COALESCE(NULLIF(q.external_id, ''), NULLIF(q.ibn, ''), q.row_id) NOT IN (${excludedKeys.map(() => "?").join(",")})`
    : "";
  return await db
    .prepare(`
      SELECT row_id, domain_desc, skill_desc
      FROM (
        SELECT
          q.row_id,
          q.domain_desc,
          q.skill_desc,
          ROW_NUMBER() OVER (
            PARTITION BY COALESCE(NULLIF(q.external_id, ''), NULLIF(q.ibn, ''), q.row_id)
            ORDER BY random()
          ) AS duplicate_rank
        FROM questions q
        LEFT JOIN progress p ON p.row_id = q.row_id
        WHERE q.source = 'collegeboard'
          AND q.subject = ?
          AND q.pool = ?
          AND q.excluded_bluebook = 0
          AND TRIM(q.domain_desc) = ?
          AND (p.status IS NULL OR p.status IN ('unanswered', 'skipped'))
          ${excludeClause}
      )
      WHERE duplicate_rank = 1
      ORDER BY random()
      LIMIT ?
    `)
    .all(normalizeSubject(subject), normalizePool(pool), domain, ...excludedKeys, limit);
}

async function selectCollegeBoardAnyRows(limit, excludedRowIds = [], subject = "math", pool = "main") {
  const excludedKeys = await dedupeKeysForRowIds(excludedRowIds);
  const excludeClause = excludedKeys.length
    ? `AND COALESCE(NULLIF(q.external_id, ''), NULLIF(q.ibn, ''), q.row_id) NOT IN (${excludedKeys.map(() => "?").join(",")})`
    : "";
  return await db
    .prepare(`
      SELECT row_id, domain_desc, skill_desc
      FROM (
        SELECT
          q.row_id,
          q.domain_desc,
          q.skill_desc,
          ROW_NUMBER() OVER (
            PARTITION BY COALESCE(NULLIF(q.external_id, ''), NULLIF(q.ibn, ''), q.row_id)
            ORDER BY random()
          ) AS duplicate_rank
        FROM questions q
        LEFT JOIN progress p ON p.row_id = q.row_id
        WHERE q.source = 'collegeboard'
          AND q.subject = ?
          AND q.pool = ?
          AND q.excluded_bluebook = 0
          AND (p.status IS NULL OR p.status IN ('unanswered', 'skipped'))
          ${excludeClause}
      )
      WHERE duplicate_rank = 1
      ORDER BY random()
      LIMIT ?
    `)
    .all(normalizeSubject(subject), normalizePool(pool), ...excludedKeys, limit);
}

async function selectCollegeBoardDifficultyRows(difficulties, limit, excludedRowIds = [], subject = "math", pool = "main") {
  const safeDifficulties = difficulties.map((difficulty) => String(difficulty).toUpperCase()).filter(Boolean);
  if (!safeDifficulties.length) return [];
  const excludedKeys = await dedupeKeysForRowIds(excludedRowIds);
  const excludeClause = excludedKeys.length
    ? `AND COALESCE(NULLIF(q.external_id, ''), NULLIF(q.ibn, ''), q.row_id) NOT IN (${excludedKeys.map(() => "?").join(",")})`
    : "";
  return await db
    .prepare(`
      SELECT row_id, domain_desc, skill_desc
      FROM (
        SELECT
          q.row_id,
          q.domain_desc,
          q.skill_desc,
          ROW_NUMBER() OVER (
            PARTITION BY COALESCE(NULLIF(q.external_id, ''), NULLIF(q.ibn, ''), q.row_id)
            ORDER BY random()
          ) AS duplicate_rank
        FROM questions q
        LEFT JOIN progress p ON p.row_id = q.row_id
        WHERE q.source = 'collegeboard'
          AND q.subject = ?
          AND q.pool = ?
          AND q.excluded_bluebook = 0
          AND UPPER(TRIM(q.difficulty)) IN (${safeDifficulties.map(() => "?").join(",")})
          AND (p.status IS NULL OR p.status IN ('unanswered', 'skipped'))
          ${excludeClause}
      )
      WHERE duplicate_rank = 1
      ORDER BY random()
      LIMIT ?
    `)
    .all(normalizeSubject(subject), normalizePool(pool), ...safeDifficulties, ...excludedKeys, limit);
}

async function getCollegeBoardUnansweredDomainCounts(excludedRowIds = [], subject = "math", pool = "main") {
  const excludeClause = excludedRowIds.length
    ? `AND q.row_id NOT IN (${excludedRowIds.map(() => "?").join(",")})`
    : "";
  return Object.fromEntries(
    (await db
      .prepare(`
        SELECT
          COALESCE(NULLIF(TRIM(q.domain_desc), ''), 'Math') AS domain,
          COUNT(*) AS available
        FROM (
          SELECT
            q.row_id,
            q.domain_desc,
            q.source,
            q.excluded_bluebook,
            p.status,
            ROW_NUMBER() OVER (
              PARTITION BY COALESCE(NULLIF(q.external_id, ''), NULLIF(q.ibn, ''), q.row_id)
              ORDER BY q.row_id
            ) AS duplicate_rank
          FROM questions q
          LEFT JOIN progress p ON p.row_id = q.row_id
          WHERE q.subject = ?
            AND q.pool = ?
        ) q
        WHERE q.source = 'collegeboard'
          AND q.excluded_bluebook = 0
          AND q.duplicate_rank = 1
          AND (q.status IS NULL OR q.status IN ('unanswered', 'skipped'))
          ${excludeClause}
        GROUP BY domain
      `)
      .all(normalizeSubject(subject), normalizePool(pool), ...excludedRowIds))
      .map((row) => [row.domain, row.available || 0])
  );
}

async function chooseRealisticQuota(excludedRowIds = [], subject = "math", pool = "main") {
  const subjectKey = normalizeSubject(subject);
  const poolKey = normalizePool(pool);
  const quotaOptions = realisticQuotaOptionsFor(subjectKey);
  const counts = await getCollegeBoardUnansweredDomainCounts(excludedRowIds, subjectKey, poolKey);
  const fillable = quotaOptions.filter((quota) =>
    Object.entries(quota).every(([domain, needed]) => (counts[domain] || 0) >= needed)
  );
  if (!fillable.length) {
    const domainSummary = Object.keys(quotaOptions[0])
      .map((domain) => `${domain}: ${counts[domain] || 0} unanswered`)
      .join("; ");
    throw new Error(`Not enough unanswered College Board questions for a realistic module. ${domainSummary}.`);
  }
  return fillable[Math.floor(Math.random() * fillable.length)];
}

function realisticQuotaOptionsFor(subject = "math") {
  return normalizeSubject(subject) === "english"
    ? ENGLISH_REALISTIC_MODULE_QUOTA_OPTIONS
    : REALISTIC_MODULE_QUOTA_OPTIONS;
}

function englishRealisticOrder(row) {
  const domain = String(row.domain_desc || "").trim();
  const skill = String(row.skill_desc || "").trim();
  if (domain === "Craft and Structure") return 0;
  if (domain === "Information and Ideas") return 1;
  if (domain === "Standard English Conventions") return 2;
  if (domain === "Expression of Ideas" && skill === "Transitions") return 3;
  if (domain === "Expression of Ideas" && skill === "Rhetorical Synthesis") return 4;
  if (domain === "Expression of Ideas") return 3;
  return 5;
}

function orderRealisticRows(rows, subject = "math") {
  if (normalizeSubject(subject) !== "english") {
    return rows.sort(() => Math.random() - 0.5);
  }
  return rows
    .map((row) => ({ ...row, orderTieBreaker: Math.random() }))
    .sort((a, b) => englishRealisticOrder(a) - englishRealisticOrder(b) || a.orderTieBreaker - b.orderTieBreaker);
}

async function createModuleRecord(
  ids,
  title,
  durationMinutes = 35,
  kind = "practice",
  submittedAt = null,
  { sectionId = null, sectionOrder = null, subject = "math", pool = "main" } = {}
) {
  const subjectKey = normalizeSubject(subject);
  const poolKey = normalizePool(pool);
  const createdAt = now();
  const parsedMinutes = Number(durationMinutes);
  const fallbackMinutes = kind === "practice" ? 35 : 0;
  const safeMinutes = Math.max(0, Number.isFinite(parsedMinutes) ? parsedMinutes : fallbackMinutes);
  const result = await db
    .prepare(`
      INSERT INTO modules (
        subject, pool, title, question_ids, duration_seconds, created_at, submitted_at, kind, section_id, section_order
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      subjectKey,
      poolKey,
      title,
      JSON.stringify(ids),
      safeMinutes * 60,
      createdAt,
      submittedAt,
      kind,
      sectionId,
      sectionOrder
    );

  return getModule(result.lastInsertRowid);
}

async function createRealisticModule({ sectionId = null, sectionOrder = null, excludedRowIds = [], quota = null, subject = "math", pool = "main" } = {}) {
  const subjectKey = normalizeSubject(subject);
  const poolKey = normalizePool(pool);
  const config = subjectConfig(subjectKey);
  if ((await activeSourceFor(subjectKey, poolKey)) !== "collegeboard") {
    throw new Error("Realistic SAT mode only works with the College Board official import.");
  }
  const selectedQuota = quota || await chooseRealisticQuota(excludedRowIds, subjectKey, poolKey);
  const rows = (await Promise.all(Object.entries(selectedQuota).map(([domain, limit]) =>
    selectCollegeBoardDomainRows(domain, limit, excludedRowIds, subjectKey, poolKey)
  ))).flat();
  if (rows.length !== config.defaultCount) {
    throw new Error("Could not create a realistic module from the available unanswered College Board questions.");
  }
  const orderedRows = orderRealisticRows(rows, subjectKey);
  return createModuleRecord(
    orderedRows.map((row) => row.row_id),
    sectionId ? `${config.label} section module ${sectionOrder} of 2` : `${config.defaultCount}-question realistic ${config.label} module`,
    config.defaultMinutes,
    "practice",
    null,
    { sectionId, sectionOrder, subject: subjectKey, pool: poolKey }
  );
}

async function createFlexibleSectionModule({ sectionId, sectionOrder, excludedRowIds = [], quota, subject = "math", pool = "main" }) {
  const subjectKey = normalizeSubject(subject);
  const poolKey = normalizePool(pool);
  const config = subjectConfig(subjectKey);
  const rows = [];
  for (const [domain, limit] of Object.entries(quota)) {
    rows.push(...await selectCollegeBoardDomainRows(domain, limit, [...excludedRowIds, ...rows.map((row) => row.row_id)], subjectKey, poolKey));
  }

  const missing = config.defaultCount - rows.length;
  if (missing > 0) {
    rows.push(...await selectCollegeBoardAnyRows(missing, [...excludedRowIds, ...rows.map((row) => row.row_id)], subjectKey, poolKey));
  }

  if (rows.length !== config.defaultCount) {
    throw new Error(`Could not create a full ${config.label} section module from the available unanswered College Board questions.`);
  }

  const orderedRows = orderRealisticRows(rows, subjectKey);
  return createModuleRecord(
    orderedRows.map((row) => row.row_id),
    `${config.label} section module ${sectionOrder} of 2`,
    config.defaultMinutes,
    "practice",
    null,
    { sectionId, sectionOrder, subject: subjectKey, pool: poolKey }
  );
}

async function createAdaptiveSectionModule({ sectionId, sectionOrder, excludedRowIds = [], subject = "math", pool = "new" }) {
  const subjectKey = normalizeSubject(subject);
  const poolKey = normalizePool(pool);
  const config = subjectConfig(subjectKey);
  const difficulties = Number(sectionOrder) === 1 ? ["E", "M"] : ["M", "H"];
  const rows = await selectCollegeBoardDifficultyRows(difficulties, config.defaultCount, excludedRowIds, subjectKey, poolKey);
  if (rows.length !== config.defaultCount) {
    throw new Error(`Could not create adaptive ${config.label} module ${sectionOrder}; not enough unanswered ${difficulties.join("/")} new questions.`);
  }
  const orderedRows = orderRealisticRows(rows, subjectKey);
  return createModuleRecord(
    orderedRows.map((row) => row.row_id),
    `New ${config.label} adaptive section module ${sectionOrder} of 2`,
    config.defaultMinutes,
    "practice",
    null,
    { sectionId, sectionOrder, subject: subjectKey, pool: poolKey }
  );
}

async function createModule({ count = 22, includeAnswered = false, durationMinutes = 35, mode = "random", subject = "math", pool = "main" }) {
  const subjectKey = normalizeSubject(subject);
  const poolKey = normalizePool(pool);
  const config = subjectConfig(subjectKey);
  if (mode === "realistic") return createRealisticModule({ subject: subjectKey, pool: poolKey });
  if (mode === "section") return createSection(subjectKey, poolKey);
  if (mode === "adaptive") return createAdaptiveSection(subjectKey, poolKey);
  const limit = Math.max(1, Math.min(Number(count) || config.defaultCount, 98));
  const where = includeAnswered
    ? "q.excluded_bluebook = 0"
    : "q.excluded_bluebook = 0 AND (p.status IS NULL OR p.status IN ('unanswered', 'skipped'))";
  const rows = await selectRows(where, limit, subjectKey, poolKey);

  if (!rows.length) {
    throw new Error("No eligible questions found. Import questions or include answered questions.");
  }

  const ids = rows.map((row) => row.row_id);
  return createModuleRecord(ids, `${ids.length}-question ${config.label} module`, durationMinutes, "practice", null, {
    subject: subjectKey,
    pool: poolKey
  });
}

async function createSection(subject = "math", pool = "main") {
  const subjectKey = normalizeSubject(subject);
  const poolKey = normalizePool(pool);
  if ((await activeSourceFor(subjectKey, poolKey)) !== "collegeboard") {
    throw new Error("Section mode only works with the College Board official import.");
  }
  const sectionId = `section-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const quotaOptions = realisticQuotaOptionsFor(subjectKey);
  const [firstQuota, secondQuota] = [
    quotaOptions[Math.floor(Math.random() * quotaOptions.length)],
    quotaOptions[Math.floor(Math.random() * quotaOptions.length)]
  ];
  let first;
  try {
    first = await createFlexibleSectionModule({
      sectionId,
      sectionOrder: 1,
      quota: firstQuota,
      subject: subjectKey,
      pool: poolKey
    });
    const second = await createFlexibleSectionModule({
      sectionId,
      sectionOrder: 2,
      excludedRowIds: first.questionIds,
      quota: secondQuota,
      subject: subjectKey,
      pool: poolKey
    });
    return {
      ...first,
      next_section_module_id: second.id
    };
  } catch (error) {
    if (first?.id) await db.prepare("DELETE FROM modules WHERE id = ?").run(first.id);
    throw error;
  }
}

async function createAdaptiveSection(subject = "math", pool = "new") {
  const subjectKey = normalizeSubject(subject);
  const poolKey = normalizePool(pool);
  if (poolKey !== "new") {
    throw new Error("Adaptive new-question sections are only available in the New Questions tab.");
  }
  if ((await activeSourceFor(subjectKey, poolKey)) !== "collegeboard") {
    throw new Error("Import new College Board questions before creating an adaptive section.");
  }

  const sectionId = `adaptive-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let first;
  try {
    first = await createAdaptiveSectionModule({ sectionId, sectionOrder: 1, subject: subjectKey, pool: poolKey });
    const second = await createAdaptiveSectionModule({
      sectionId,
      sectionOrder: 2,
      excludedRowIds: first.questionIds,
      subject: subjectKey,
      pool: poolKey
    });
    return { ...first, next_section_module_id: second.id };
  } catch (error) {
    if (first?.id) await db.prepare("DELETE FROM modules WHERE id = ?").run(first.id);
    throw error;
  }
}

async function createReviewModule({ mode, count = 22, durationMinutes = 0, subject = "math", pool = "main" }) {
  const subjectKey = normalizeSubject(subject);
  const poolKey = normalizePool(pool);
  const limit = Math.max(1, Math.min(Number(count) || 22, 98));
  const reviewModes = {
    incorrect: {
      title: "Incorrect question review",
      where: "q.excluded_bluebook = 0 AND p.status = 'incorrect'"
    },
    flagged: {
      title: "Flagged question review",
      where: "q.excluded_bluebook = 0 AND COALESCE(p.flagged, 0) = 1"
    }
  };
  const config = reviewModes[mode];
  if (!config) throw new Error("Unknown review mode.");

  const rows = await selectRows(config.where, limit, subjectKey, poolKey);
  if (!rows.length) throw new Error(`No ${mode} questions found yet.`);

  const ids = rows.map((row) => row.row_id);
  return createModuleRecord(ids, `${config.title} (${ids.length})`, durationMinutes, `review_${mode}`, now(), {
    subject: subjectKey,
    pool: poolKey
  });
}

async function listModules(subject = "math", pool = "main") {
  return (await db
    .prepare(`
      SELECT
        m.id,
        m.title,
        m.created_at,
        m.submitted_at,
        json_array_length(m.question_ids) AS question_count,
        SUM(CASE WHEN ma.status = 'correct' THEN 1 ELSE 0 END) AS correct,
        SUM(CASE WHEN ma.status = 'incorrect' THEN 1 ELSE 0 END) AS incorrect,
        SUM(CASE WHEN ma.status = 'skipped' THEN 1 ELSE 0 END) AS skipped,
        SUM(CASE WHEN COALESCE(ma.flagged, 0) = 1 THEN 1 ELSE 0 END) AS flagged
      FROM modules m
      LEFT JOIN module_answers ma ON ma.module_id = m.id
      WHERE m.kind = 'practice'
        AND m.subject = ?
        AND m.pool = ?
      GROUP BY m.id
      ORDER BY m.created_at DESC
      LIMIT 12
    `)
    .all(normalizeSubject(subject), normalizePool(pool)))
    .map((row) => ({
      ...row,
      correct: row.correct || 0,
      incorrect: row.incorrect || 0,
      skipped: row.skipped || 0,
      flagged: row.flagged || 0
    }));
}

async function getModule(moduleId) {
  const module = await db.prepare("SELECT * FROM modules WHERE id = ?").get(moduleId);
  if (!module) return null;
  const ids = JSON.parse(module.question_ids);
  const placeholders = ids.map(() => "?").join(",");
  const questionRows = ids.length
    ? await db
        .prepare(`
          SELECT q.row_id, q.source, q.subject, q.question_id, q.uid, q.external_id, q.ibn, q.domain_desc,
                 q.skill_desc, q.difficulty, COALESCE(p.flagged, 0) AS flagged,
                 p.status, ma.answer, ma.flagged AS module_flagged, ma.is_correct,
                 COALESCE(ma.time_spent_seconds, 0) AS time_spent_seconds
          FROM questions q
          LEFT JOIN progress p ON p.row_id = q.row_id
          LEFT JOIN module_answers ma ON ma.module_id = ? AND ma.row_id = q.row_id
          WHERE q.row_id IN (${placeholders})
        `)
        .all(moduleId, ...ids)
    : [];
  const timeSegments = ids.length
    ? await db
        .prepare(`
          SELECT row_id, pass_index, seconds
          FROM module_time_segments
          WHERE module_id = ?
          ORDER BY row_id, pass_index
        `)
        .all(moduleId)
    : [];
  const segmentsById = new Map();
  for (const segment of timeSegments) {
    if (!segmentsById.has(segment.row_id)) segmentsById.set(segment.row_id, []);
    segmentsById.get(segment.row_id).push({
      pass_index: Number(segment.pass_index) || 0,
      seconds: Number(segment.seconds) || 0
    });
  }
  const byId = new Map(questionRows.map((row) => [row.row_id, row]));
  const nextSectionModule = module.section_id
    ? await db
        .prepare(`
          SELECT id
          FROM modules
          WHERE section_id = ? AND section_order = ?
          LIMIT 1
        `)
        .get(module.section_id, Number(module.section_order || 0) + 1)
    : null;
  return {
    ...module,
    next_section_module_id: nextSectionModule?.id || null,
    questionIds: ids,
    questions: ids
      .map((id) => {
        const row = byId.get(id);
        return row ? { ...row, time_segments: segmentsById.get(id) || [] } : null;
      })
      .filter(Boolean)
  };
}

async function activateNextSectionModule(moduleId, activatedAt) {
  const module = await db.prepare("SELECT section_id, section_order FROM modules WHERE id = ?").get(moduleId);
  if (!module?.section_id || Number(module.section_order) !== 1) return null;
  const nextModule = await db
    .prepare(`
      SELECT id
      FROM modules
      WHERE section_id = ? AND section_order = 2 AND submitted_at IS NULL
      LIMIT 1
    `)
    .get(module.section_id);
  if (!nextModule) return null;
  await db.prepare("UPDATE modules SET created_at = ? WHERE id = ?").run(activatedAt, nextModule.id);
  return nextModule.id;
}

async function saveDraftAnswer(moduleId, rowId, answer, flagged) {
  await db.prepare(`
    INSERT INTO module_answers (module_id, row_id, answer, flagged, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(module_id, row_id) DO UPDATE SET
      answer = excluded.answer,
      flagged = excluded.flagged,
      updated_at = excluded.updated_at
  `).run(moduleId, rowId, answer ?? "", flagged ? 1 : 0, now());

  await db.prepare(`
    INSERT INTO progress (row_id, status, flagged, updated_at)
    VALUES (?, 'unanswered', ?, ?)
    ON CONFLICT(row_id) DO UPDATE SET
      flagged = excluded.flagged,
      updated_at = excluded.updated_at
  `).run(rowId, flagged ? 1 : 0, now());
}

async function saveFlag(moduleId, rowId, flagged) {
  const updatedAt = now();
  const result = await db.prepare(`
    UPDATE module_answers
    SET flagged = ?, updated_at = ?
    WHERE module_id = ? AND row_id = ?
  `).run(flagged ? 1 : 0, updatedAt, moduleId, rowId);

  if (!result.changes) {
    await db.prepare(`
      INSERT INTO module_answers (module_id, row_id, answer, flagged, updated_at)
      VALUES (?, ?, '', ?, ?)
    `).run(moduleId, rowId, flagged ? 1 : 0, updatedAt);
  }

  await db.prepare(`
    INSERT INTO progress (row_id, status, flagged, updated_at)
    VALUES (?, 'unanswered', ?, ?)
    ON CONFLICT(row_id) DO UPDATE SET
      flagged = excluded.flagged,
      updated_at = excluded.updated_at
  `).run(rowId, flagged ? 1 : 0, updatedAt);
}

async function saveQuestionTime(moduleId, rowId, timeSpentSeconds, passIndex, elapsedSeconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(timeSpentSeconds) || 0));
  const safePassIndex = Math.max(0, Math.floor(Number(passIndex) || 0));
  const safeElapsedSeconds = Math.max(0, Math.floor(Number(elapsedSeconds) || 0));
  const updatedAt = now();
  await db.prepare(`
    INSERT INTO module_answers (module_id, row_id, answer, flagged, time_spent_seconds, updated_at)
    VALUES (?, ?, '', 0, ?, ?)
    ON CONFLICT(module_id, row_id) DO UPDATE SET
      time_spent_seconds = MAX(module_answers.time_spent_seconds, excluded.time_spent_seconds),
      updated_at = excluded.updated_at
  `).run(moduleId, rowId, safeSeconds, updatedAt);

  if (safePassIndex > 0 && safeElapsedSeconds > 0) {
    await db.prepare(`
      INSERT INTO module_time_segments (module_id, row_id, pass_index, seconds, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(module_id, row_id, pass_index) DO UPDATE SET
        seconds = module_time_segments.seconds + excluded.seconds,
        updated_at = excluded.updated_at
    `).run(moduleId, rowId, safePassIndex, safeElapsedSeconds, updatedAt);
  }
}

async function clearIncorrectQuestion(rowId) {
  await db.prepare(`
    UPDATE progress
    SET status = 'unanswered',
        selected_answer = NULL,
        answered_at = NULL,
        updated_at = ?
    WHERE row_id = ? AND status = 'incorrect'
  `).run(now(), rowId);
}

async function submitModule(moduleId) {
  const module = await getModule(moduleId);
  if (!module) throw new Error("Module not found.");
  const submittedAt = now();

  for (const question of module.questions) {
    const answerRow = await db
      .prepare("SELECT answer, flagged FROM module_answers WHERE module_id = ? AND row_id = ?")
      .get(moduleId, question.row_id);
    const answer = answerRow?.answer || "";
    const content = await getQuestionContent(question);
    const grade = gradeAnswer(content, answer);

    await db.prepare(`
      INSERT INTO module_answers (module_id, row_id, answer, flagged, status, is_correct, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(module_id, row_id) DO UPDATE SET
        answer = excluded.answer,
        flagged = excluded.flagged,
        status = excluded.status,
        is_correct = excluded.is_correct,
        updated_at = excluded.updated_at
    `).run(
      moduleId,
      question.row_id,
      answer,
      answerRow?.flagged ? 1 : 0,
      grade.status,
      grade.isCorrect === null ? null : grade.isCorrect ? 1 : 0,
      submittedAt
    );

    await db.prepare(`
      INSERT INTO progress (row_id, status, flagged, selected_answer, answered_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(row_id) DO UPDATE SET
        status = excluded.status,
        flagged = excluded.flagged,
        selected_answer = excluded.selected_answer,
        answered_at = CASE
          WHEN excluded.status IN ('correct', 'incorrect') THEN excluded.answered_at
          ELSE progress.answered_at
        END,
        updated_at = excluded.updated_at
    `).run(
      question.row_id,
      grade.status,
      answerRow?.flagged ? 1 : 0,
      answer,
      isAnsweredStatus(grade.status) ? submittedAt : null,
      submittedAt
    );
  }

  await db.prepare("UPDATE modules SET submitted_at = ? WHERE id = ?").run(submittedAt, moduleId);
  const nextSectionModuleId = await activateNextSectionModule(moduleId, submittedAt);
  const submittedModule = await getModule(moduleId);
  return {
    ...submittedModule,
    next_section_module_id: nextSectionModuleId || submittedModule?.next_section_module_id || null
  };
}

function normalizeVocabKind(value) {
  return value === "root" ? "root" : "word";
}

async function resolveVocabSet(kind = "word", setValue = null) {
  const kindKey = normalizeVocabKind(kind);
  const requested = String(setValue || "").trim();
  let set;
  if (requested) {
    set = /^\d+$/.test(requested)
      ? await db.prepare("SELECT * FROM vocab_sets WHERE id = ? AND kind = ? AND active = 1").get(Number(requested), kindKey)
      : await db.prepare("SELECT * FROM vocab_sets WHERE slug = ? AND kind = ? AND active = 1").get(requested, kindKey);
  }
  if (!set) {
    const fallbackSlug = kindKey === "root" ? "roots" : "sat-vocabulary";
    set = await db.prepare("SELECT * FROM vocab_sets WHERE slug = ? AND kind = ? AND active = 1").get(fallbackSlug, kindKey);
  }
  if (!set) throw new Error("Vocabulary set not found.");
  return set;
}

async function listVocabSets(kind = "word") {
  const kindKey = normalizeVocabKind(kind);
  return (await db.prepare(`
    SELECT s.*, COUNT(m.item_id) AS total
    FROM vocab_sets s
    LEFT JOIN vocab_set_items m ON m.set_id = s.id
    WHERE s.kind = ? AND s.active = 1
    GROUP BY s.id
    ORDER BY s.built_in DESC, s.id
  `).all(kindKey)).map((set) => ({ ...set, total: Number(set.total || 0) }));
}

async function vocabDashboard(kind = "word", setValue = null) {
  const kindKey = normalizeVocabKind(kind);
  const set = await resolveVocabSet(kindKey, setValue);
  const current = now();
  const totals = await db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN p.item_id IS NULL OR p.state = 'new' THEN 1 ELSE 0 END) AS new_count,
      SUM(CASE WHEN p.state = 'learning' THEN 1 ELSE 0 END) AS learning,
      SUM(CASE WHEN p.state = 'mastered' THEN 1 ELSE 0 END) AS mastered,
      SUM(CASE WHEN p.item_id IS NOT NULL AND p.due_at <= ? THEN 1 ELSE 0 END) AS due
    FROM vocab_items i
    JOIN vocab_set_items m ON m.item_id = i.id
    LEFT JOIN vocab_progress p ON p.item_id = i.id
      AND p.set_id = m.set_id
    WHERE i.kind = ? AND i.active = 1 AND m.set_id = ?
  `).get(current, kindKey, set.id);
  const reviewStats = await db.prepare(`
    SELECT COUNT(*) AS reviews, SUM(correct) AS correct
    FROM vocab_reviews r
    WHERE r.set_id = ?
  `).get(set.id);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const reviewedToday = (await db.prepare(`
    SELECT COUNT(*) AS count
    FROM vocab_reviews r
    WHERE r.set_id = ? AND r.reviewed_at >= ?
  `).get(set.id, todayStart.toISOString())).count;
  const reviews = Number(reviewStats.reviews || 0);
  return {
    kind: kindKey,
    set,
    total: Number(totals.total || 0),
    new: Number(totals.new_count || 0),
    learning: Number(totals.learning || 0),
    mastered: Number(totals.mastered || 0),
    due: Number(totals.due || 0),
    reviewedToday: Number(reviewedToday || 0),
    accuracy: reviews ? Math.round((Number(reviewStats.correct || 0) / reviews) * 100) : 0,
    reviews
  };
}

function shuffle(values) {
  const output = [...values];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [output[index], output[swap]] = [output[swap], output[index]];
  }
  return output;
}

async function vocabSession(kind = "word", requestedLimit = 15, setValue = null) {
  const kindKey = normalizeVocabKind(kind);
  const set = await resolveVocabSet(kindKey, setValue);
  const limit = Math.max(1, Math.min(Number(requestedLimit) || 15, 30));
  const current = now();
  const items = await db.prepare(`
    SELECT i.*, COALESCE(m.display_term, i.term) AS term,
      COALESCE(p.state, 'new') AS state, COALESCE(p.interval_days, 0) AS interval_days
    FROM vocab_items i
    JOIN vocab_set_items m ON m.item_id = i.id AND m.set_id = ?
    LEFT JOIN vocab_progress p ON p.item_id = i.id AND p.set_id = m.set_id
    WHERE i.kind = ?
      AND i.active = 1
      AND (p.item_id IS NULL OR p.state = 'new' OR p.due_at <= ?)
    ORDER BY
      CASE WHEN p.item_id IS NOT NULL AND p.state <> 'new' THEN 0 ELSE 1 END,
      COALESCE(p.due_at, '9999-12-31T00:00:00.000Z'),
      RANDOM()
    LIMIT ?
  `).all(set.id, kindKey, current, limit);
  const pool = await db.prepare(`
    SELECT i.id, COALESCE(m.display_term, i.term) AS term, i.definition
    FROM vocab_items i
    JOIN vocab_set_items m ON m.item_id = i.id
    WHERE i.kind = ? AND i.active = 1 AND m.set_id = ?
  `).all(kindKey, set.id);

  const questions = items.map((item, index) => {
    const shuffledPool = shuffle(pool.filter((candidate) => candidate.id !== item.id));
    if (kindKey === "word") {
      const seenDefinitions = new Set([item.definition.trim().toLowerCase()]);
      const distractors = [];
      for (const candidate of shuffledPool) {
        const definitionKey = candidate.definition.trim().toLowerCase();
        if (!definitionKey || seenDefinitions.has(definitionKey)) continue;
        seenDefinitions.add(definitionKey);
        distractors.push(candidate);
        if (distractors.length === 3) break;
      }
      const candidates = [item, ...distractors];
      return {
        id: item.id,
        prompt: "Which definition best matches this word?",
        clue: item.term,
        answer: item.definition,
        options: shuffle(candidates).map((option) => option.definition),
        optionDetails: Object.fromEntries(candidates.map((option) => [option.definition, option])),
        item
      };
    }

    const distractors = shuffledPool.slice(0, 3);
    const candidates = [item, ...distractors];
    const rootToMeaning = kindKey === "root" && index % 2 === 0;
    if (rootToMeaning) {
      return {
        id: item.id,
        prompt: `Which meaning best matches the root “${item.term}”?`,
        clue: item.family,
        answer: item.definition,
        options: shuffle(candidates).map((option) => option.definition),
        optionDetails: Object.fromEntries(candidates.map((option) => [option.definition, option])),
        item
      };
    }
    return {
      id: item.id,
      prompt: "Which root matches this meaning?",
      clue: item.definition,
      answer: item.term,
      options: shuffle(candidates).map((option) => option.term),
      optionDetails: Object.fromEntries(candidates.map((option) => [option.term, option])),
      item
    };
  });

  return { kind: kindKey, set, count: questions.length, questions, items };
}

async function listVocabItems(kind = "word", search = "", setValue = null) {
  const kindKey = normalizeVocabKind(kind);
  const set = await resolveVocabSet(kindKey, setValue);
  const query = `%${String(search || "").trim()}%`;
  return await db.prepare(`
    SELECT i.*, COALESCE(m.display_term, i.term) AS term,
      COALESCE(p.state, 'new') AS state, p.due_at, COALESCE(p.interval_days, 0) AS interval_days
    FROM vocab_items i
    JOIN vocab_set_items m ON m.item_id = i.id AND m.set_id = ?
    LEFT JOIN vocab_progress p ON p.item_id = i.id AND p.set_id = m.set_id
    WHERE i.kind = ? AND i.active = 1
      AND (i.term LIKE ? OR i.definition LIKE ? OR i.family LIKE ?)
    ORDER BY i.term COLLATE NOCASE
    LIMIT 400
  `).all(set.id, kindKey, query, query, query);
}

async function addVocabWord({ term, definition, example = "", setId = null }) {
  const set = await resolveVocabSet("word", setId);
  const cleanTerm = String(term || "").trim();
  const cleanDefinition = String(definition || "").trim();
  const cleanExample = String(example || "").trim();
  if (!cleanTerm || !cleanDefinition) throw new Error("Word and definition are required.");
  if (cleanTerm.length > 100 || cleanDefinition.length > 600 || cleanExample.length > 800) {
    throw new Error("That entry is too long.");
  }
  let item = await db.prepare("SELECT * FROM vocab_items WHERE kind = 'word' AND term = ? COLLATE NOCASE").get(cleanTerm);
  if (!item) {
    const result = await db.prepare(`
      INSERT INTO vocab_items (kind, term, definition, example, family, source, active, created_at)
      VALUES ('word', ?, ?, ?, '', 'user-added', 1, ?)
    `).run(cleanTerm, cleanDefinition, cleanExample, now());
    item = await db.prepare("SELECT * FROM vocab_items WHERE id = ?").get(result.lastInsertRowid);
  }
  const membership = await db.prepare("SELECT 1 FROM vocab_set_items WHERE set_id = ? AND item_id = ?").get(set.id, item.id);
  if (membership) throw new Error(`That word is already in ${set.name}.`);
  const position = (await db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS value FROM vocab_set_items WHERE set_id = ?").get(set.id)).value;
  await db.prepare(`
    INSERT INTO vocab_set_items (set_id, item_id, position, added_at, display_term)
    VALUES (?, ?, ?, ?, ?)
  `).run(set.id, item.id, position, now(), cleanTerm);
  return item;
}

async function reviewVocabItem(itemId, rating, setValue = null) {
  const safeRating = ["again", "hard", "good", "easy"].includes(rating) ? rating : "good";
  const item = await db.prepare("SELECT * FROM vocab_items WHERE id = ? AND active = 1").get(Number(itemId));
  if (!item) throw new Error("Vocabulary item not found.");
  const set = await resolveVocabSet(item.kind, setValue);
  const membership = await db.prepare("SELECT 1 FROM vocab_set_items WHERE set_id = ? AND item_id = ?").get(set.id, item.id);
  if (!membership) throw new Error("That item is not in the selected vocabulary set.");
  const previous = await db.prepare("SELECT * FROM vocab_progress WHERE set_id = ? AND item_id = ?").get(set.id, item.id);
  const oldInterval = Number(previous?.interval_days || 0);
  let intervalDays = 0;
  let dueAt;
  let state = "learning";
  if (safeRating === "again") {
    dueAt = new Date(Date.now() + 10 * 60 * 1000);
  } else if (safeRating === "hard") {
    intervalDays = oldInterval <= 1 ? 1 : Math.max(2, Math.round(oldInterval * 1.2));
    dueAt = new Date(Date.now() + intervalDays * 86400000);
  } else if (safeRating === "easy") {
    intervalDays = oldInterval === 0 ? 4 : Math.max(4, Math.round(oldInterval * 3));
    dueAt = new Date(Date.now() + intervalDays * 86400000);
  } else {
    intervalDays = oldInterval === 0 ? 1 : oldInterval < 3 ? 3 : Math.max(4, Math.round(oldInterval * 2.2));
    dueAt = new Date(Date.now() + intervalDays * 86400000);
  }
  if (intervalDays >= 21) state = "mastered";
  else if (intervalDays > 1) state = "review";

  const reviewedAt = now();
  await db.prepare(`
    INSERT INTO vocab_progress (set_id, item_id, state, due_at, interval_days, streak, lapses, last_reviewed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(set_id, item_id) DO UPDATE SET
      state = excluded.state,
      due_at = excluded.due_at,
      interval_days = excluded.interval_days,
      streak = CASE WHEN ? = 'again' THEN 0 ELSE vocab_progress.streak + 1 END,
      lapses = vocab_progress.lapses + CASE WHEN ? = 'again' THEN 1 ELSE 0 END,
      last_reviewed_at = excluded.last_reviewed_at
  `).run(
    set.id,
    item.id,
    state,
    dueAt.toISOString(),
    intervalDays,
    safeRating === "again" ? 0 : 1,
    safeRating === "again" ? 1 : 0,
    reviewedAt,
    safeRating,
    safeRating
  );
  await db.prepare(`
    INSERT INTO vocab_reviews (set_id, item_id, rating, correct, reviewed_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(set.id, item.id, safeRating, safeRating === "again" ? 0 : 1, reviewedAt);
  return {
    itemId: item.id,
    rating: safeRating,
    state,
    intervalDays,
    dueAt: dueAt.toISOString(),
    dashboard: await vocabDashboard(item.kind, set.id)
  };
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const urlSubject = subjectFromUrl(url);
  const urlPool = poolFromUrl(url);

  try {
    if (url.pathname === "/api/vocab/sets" && req.method === "GET") {
      return json(res, 200, { success: true, data: await listVocabSets(url.searchParams.get("kind")) });
    }

    if (url.pathname === "/api/vocab/dashboard" && req.method === "GET") {
      return json(res, 200, {
        success: true,
        data: await vocabDashboard(url.searchParams.get("kind"), url.searchParams.get("set"))
      });
    }

    if (url.pathname === "/api/vocab/session" && req.method === "GET") {
      return json(res, 200, {
        success: true,
        data: await vocabSession(url.searchParams.get("kind"), url.searchParams.get("limit"), url.searchParams.get("set"))
      });
    }

    if (url.pathname === "/api/vocab/items" && req.method === "GET") {
      return json(res, 200, {
        success: true,
        data: await listVocabItems(url.searchParams.get("kind"), url.searchParams.get("search"), url.searchParams.get("set"))
      });
    }

    if (url.pathname === "/api/vocab/words" && req.method === "POST") {
      const body = await readJson(req);
      return json(res, 201, { success: true, data: await addVocabWord(body) });
    }

    if (url.pathname === "/api/vocab/review" && req.method === "POST") {
      const body = await readJson(req);
      return json(res, 200, { success: true, data: await reviewVocabItem(body.itemId, body.rating, body.setId) });
    }

    if (url.pathname === "/api/status" && req.method === "GET") {
      return json(res, 200, { success: true, data: await getStatus(urlSubject, urlPool) });
    }

    if (url.pathname === "/api/cache-status" && req.method === "GET") {
      return json(res, 200, { success: true, data: await publicCacheJob(urlSubject, urlPool) });
    }

    if (url.pathname === "/api/cache-all" && req.method === "POST") {
      const body = await readJson(req);
      return json(res, 200, { success: true, data: await startCacheAllQuestions(subjectFromBody(body), poolFromBody(body)) });
    }

    if (url.pathname === "/api/import" && req.method === "POST") {
      const body = await readJson(req);
      return json(res, 200, { success: true, data: await importQuestions(body.source, subjectFromBody(body), poolFromBody(body)) });
    }

    if (url.pathname === "/api/import-new" && req.method === "POST") {
      const body = await readJson(req);
      return json(res, 200, { success: true, data: await importNewQuestions(subjectFromBody(body)) });
    }

    if (url.pathname === "/api/modules" && req.method === "GET") {
      return json(res, 200, { success: true, data: await listModules(urlSubject, urlPool) });
    }

    if (url.pathname === "/api/modules" && req.method === "POST") {
      const body = await readJson(req);
      return json(res, 200, { success: true, data: await createModule(body) });
    }

    if (url.pathname === "/api/review-modules" && req.method === "POST") {
      const body = await readJson(req);
      return json(res, 200, { success: true, data: await createReviewModule(body) });
    }

    const moduleMatch = url.pathname.match(/^\/api\/modules\/(\d+)$/);
    if (moduleMatch && req.method === "GET") {
      const module = await getModule(Number(moduleMatch[1]));
      return module
        ? json(res, 200, { success: true, data: module })
        : json(res, 404, { success: false, error: "Module not found." });
    }

    const answerMatch = url.pathname.match(/^\/api\/modules\/(\d+)\/answers$/);
    if (answerMatch && req.method === "POST") {
      const body = await readJson(req);
      await saveDraftAnswer(Number(answerMatch[1]), body.rowId, body.answer, body.flagged);
      return json(res, 200, { success: true });
    }

    const flagMatch = url.pathname.match(/^\/api\/modules\/(\d+)\/flag$/);
    if (flagMatch && req.method === "POST") {
      const body = await readJson(req);
      await saveFlag(Number(flagMatch[1]), body.rowId, body.flagged);
      return json(res, 200, { success: true });
    }

    const timeMatch = url.pathname.match(/^\/api\/modules\/(\d+)\/time$/);
    if (timeMatch && req.method === "POST") {
      const body = await readJson(req);
      await saveQuestionTime(
        Number(timeMatch[1]),
        body.rowId,
        body.timeSpentSeconds,
        body.passIndex,
        body.elapsedSeconds
      );
      return json(res, 200, { success: true });
    }

    const submitMatch = url.pathname.match(/^\/api\/modules\/(\d+)\/submit$/);
    if (submitMatch && req.method === "POST") {
      return json(res, 200, { success: true, data: await submitModule(Number(submitMatch[1])) });
    }

    const clearIncorrectMatch = url.pathname.match(/^\/api\/questions\/(.+)\/clear-incorrect$/);
    if (clearIncorrectMatch && req.method === "POST") {
      const rowId = decodeURIComponent(clearIncorrectMatch[1]);
      await clearIncorrectQuestion(rowId);
      const body = await readJson(req);
      return json(res, 200, { success: true, data: await getStatus(subjectFromBody(body), poolFromBody(body)) });
    }

    const questionMatch = url.pathname.match(/^\/api\/questions\/(.+)$/);
    if (questionMatch && req.method === "GET") {
      const rowId = decodeURIComponent(questionMatch[1]);
      const question = await getQuestion(rowId);
      if (!question) return json(res, 404, { success: false, error: "Question not found." });
      const content = await getQuestionContent(question);
      return json(res, 200, { success: true, data: { question, content } });
    }

    if (url.pathname === "/api/reset-progress" && req.method === "POST") {
      const body = await readJson(req);
      const subjectKey = subjectFromBody(body);
      const poolKey = poolFromBody(body);
      await db.prepare(`
        DELETE FROM module_time_segments
        WHERE module_id IN (SELECT id FROM modules WHERE subject = ? AND pool = ?)
      `).run(subjectKey, poolKey);
      await db.prepare(`
        DELETE FROM module_answers
        WHERE module_id IN (SELECT id FROM modules WHERE subject = ? AND pool = ?)
      `).run(subjectKey, poolKey);
      await db.prepare("DELETE FROM modules WHERE subject = ? AND pool = ?").run(subjectKey, poolKey);
      await db.prepare(`
        DELETE FROM progress
        WHERE row_id IN (SELECT row_id FROM questions WHERE subject = ? AND pool = ?)
      `).run(subjectKey, poolKey);
      return json(res, 200, { success: true, data: await getStatus(subjectKey, poolKey) });
    }

    await serveStatic(url.pathname, res);
  } catch (error) {
    console.error(error);
    json(res, 500, { success: false, error: error.message || "Server error" });
  }
}

async function serveStatic(pathname, res) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = resolve(publicDir, `.${safePath}`);
  if (!filePath.startsWith(publicDir)) {
    return json(res, 403, { success: false, error: "Forbidden" });
  }

  try {
    const data = await readFile(filePath);
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".png": "image/png",
      ".svg": "image/svg+xml"
    };
    res.writeHead(200, { "content-type": types[extname(filePath)] || "application/octet-stream" });
    res.end(data);
  } catch {
    const data = await readFile(join(publicDir, "index.html"));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(data);
  }
}

export { route };

const isMainModule = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule && !process.env.VERCEL) {
  createServer(route).listen(port, host, () => {
    console.log(`SAT prep app running at http://${host}:${port}`);
    console.log(`${db.kind === "remote" ? "Turso database" : "SQLite database"}: ${db.kind === "remote" ? process.env.TURSO_DATABASE_URL : dbPath}`);
  });
}
