import { normalizeContentCorrectAnswers } from "../practice/grading.js";
import { sanitizeQuestionContent } from "../../platform/question-content.js";
import { normalizeSubject } from "../../subjects.js";
import { createCollegeBoardClient } from "./college-board-client.js";
import { canonicalQuestionId } from "./normalization.js";

export function createCatalogService({ db, currentUserId, collegeBoard = createCollegeBoardClient() }) {
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

  function now() {
    return new Date().toISOString();
  }

  function rowIdFor(question, subject = "math") {
    const canonical = canonicalQuestionId(question) || question.rowIdBase || question.uId;
    if (!canonical) throw new Error("Question is missing a stable College Board identifier.");
    return `${normalizeSubject(subject)}:${canonical}`;
  }

  function contentKeyFor(question) {
    return question.row_id;
  }

  function jsonValue(value) {
    if (typeof value !== "string") return value;
    return JSON.parse(value);
  }

  function contentIsUsable(question, content) {
    if (!content) return false;
    const hasPrompt = Boolean(content.stem || content.stimulus);
    const hasCorrectAnswer = Array.isArray(content.correct_answer) && content.correct_answer.length > 0;
    return question.source === "collegeboard" && hasPrompt && hasCorrectAnswer;
  }

  async function cachedContentFor(question) {
    const cached = await db
      .prepare("SELECT data_json FROM question_content WHERE question_row_id = ?")
      .get(contentKeyFor(question));
    if (!cached) return null;
    try {
      return normalizeContentCorrectAnswers(sanitizeQuestionContent(jsonValue(cached.data_json)));
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
    return source === "collegeboard" ? "College Board official" : "No catalog imported";
  }

  async function activeSourceFor(subject = "math", pool = "main") {
    const subjectKey = normalizeSubject(subject);
    const poolKey = normalizePool(pool);
    return getSetting(`activeSource:${subjectKey}:${poolKey}`, "");
  }

  async function getQuestion(rowId) {
    const userId = currentUserId();
    return await db
      .prepare(`
        SELECT q.*, p.status, p.flagged, p.selected_answer, p.answered_at
        FROM question_catalog q
        LEFT JOIN progress p ON p.user_id = ? AND p.row_id = q.row_id
        WHERE q.row_id = ?
      `)
      .get(userId, rowId);
  }

  async function getQuestionContent(question) {
    const contentKey = contentKeyFor(question);
    const cached = await db
      .prepare("SELECT data_json FROM question_content WHERE question_row_id = ?")
      .get(contentKey);
    if (cached) {
      const content = sanitizeQuestionContent(jsonValue(cached.data_json));
      const needsLegacyRefresh =
        question.source === "collegeboard" &&
        question.ibn &&
        (!content.stimulus || !(Array.isArray(content.correct_answer) && content.correct_answer.length));
      if (!needsLegacyRefresh && contentIsUsable(question, content)) return normalizeContentCorrectAnswers(content);
    }

    if (question.source !== "collegeboard") throw new Error("Unsupported question source.");
    const content = sanitizeQuestionContent(await collegeBoard.loadQuestionContent(question));

    await db.prepare(`
      INSERT INTO question_content (question_row_id, data_json, fetched_at)
      VALUES (?, ?, ?)
      ON CONFLICT(question_row_id) DO UPDATE SET
        data_json = excluded.data_json,
        fetched_at = excluded.fetched_at,
        content_version = question_content.content_version + 1
    `).run(contentKey, JSON.stringify(content), now());

    return content;
  }

  async function upsertImportedQuestions(database, questions, { source, subject, pool, live, importedAt }) {
    for (let offset = 0; offset < questions.length; offset += 100) {
      const batch = questions.slice(offset, offset + 100);
      const normalized = batch.map((question) => {
        const externalId = question.external_id || "";
        const sourceQuestionId = canonicalQuestionId(question) || question.uId;
        return {
          rowId: rowIdFor(question, subject),
          sourceQuestionId,
          uid: question.uId || "",
          externalId,
          ibn: question.ibn || "",
          program: question.program || "",
          domain: question.primary_class_cd || "",
          domainDesc: question.primary_class_cd_desc || "",
          skill: question.skill_cd || "",
          skillDesc: question.skill_desc || "",
          difficulty: question.difficulty || "",
          excludedBluebook: Boolean(externalId && live.has(externalId)),
          rawJson: JSON.stringify(question)
        };
      });

      const questionValues = normalized.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
      const questionArgs = normalized.flatMap((question) => [
        question.rowId,
        subject,
        question.program,
        question.domain,
        question.domainDesc,
        question.skill,
        question.skillDesc,
        question.difficulty,
        question.excludedBluebook,
        question.rawJson,
        importedAt
      ]);
      await database.prepare(`
        INSERT INTO questions (
          row_id, subject, program, domain, domain_desc, skill, skill_desc, difficulty,
          excluded_bluebook, raw_json, imported_at
        ) VALUES ${questionValues}
        ON CONFLICT(row_id) DO UPDATE SET
          program = excluded.program,
          domain = excluded.domain,
          domain_desc = excluded.domain_desc,
          skill = excluded.skill,
          skill_desc = excluded.skill_desc,
          difficulty = excluded.difficulty,
          excluded_bluebook = excluded.excluded_bluebook,
          raw_json = excluded.raw_json,
          imported_at = excluded.imported_at,
          updated_at = excluded.imported_at
      `).run(...questionArgs);

      const sourceValues = normalized.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
      const sourceArgs = normalized.flatMap((question) => [
        question.rowId,
        source,
        question.sourceQuestionId,
        question.uid,
        question.externalId,
        question.ibn,
        importedAt,
        importedAt
      ]);
      await database.prepare(`
        INSERT INTO question_source_refs (
          question_row_id, source, source_question_id, uid, external_id, ibn, first_seen_at, last_seen_at
        ) VALUES ${sourceValues}
        ON CONFLICT(source, source_question_id) DO UPDATE SET
          question_row_id = excluded.question_row_id,
          uid = excluded.uid,
          external_id = excluded.external_id,
          ibn = excluded.ibn,
          last_seen_at = excluded.last_seen_at
      `).run(...sourceArgs);

      const poolValues = normalized.map(() => "(?, ?, true, ?, ?)").join(", ");
      const poolArgs = normalized.flatMap((question) => [question.rowId, pool, importedAt, importedAt]);
      await database.prepare(`
        INSERT INTO question_pool_memberships (
          question_row_id, pool, active, first_seen_at, last_seen_at
        ) VALUES ${poolValues}
        ON CONFLICT(question_row_id, pool) DO UPDATE SET
          active = true,
          last_seen_at = excluded.last_seen_at
      `).run(...poolArgs);
    }
  }

  async function existingCollegeBoardCanonicals(subject = "math") {
    return new Set(
      (await db
        .prepare(`
          SELECT row_id AS canonical
          FROM questions
          WHERE subject = ?
        `)
        .all(normalizeSubject(subject)))
        .map((row) => row.canonical)
        .filter(Boolean)
    );
  }

  async function importNewQuestions(subject = "math") {
    const subjectKey = normalizeSubject(subject);
    const importData = await collegeBoard.loadImportData(subjectKey);
    const existing = await existingCollegeBoardCanonicals(subjectKey);
    const importedAt = now();
    const newQuestions = importData.questions.filter((question) => {
      const canonical = canonicalQuestionId(question);
      return canonical && !existing.has(rowIdFor(question, subjectKey)) && !importData.live.has(canonical);
    });

    await db.transaction(async (tx) => {
      await upsertImportedQuestions(tx, newQuestions, {
        source: importData.source,
        subject: subjectKey,
        pool: "new",
        live: new Set(),
        importedAt
      });
      await setSetting(`activeSource:${subjectKey}:new`, importData.source, tx);
    });

    return {
      source: importData.source,
      subject: subjectKey,
      pool: "new",
      imported: newQuestions.length,
      importedAt
    };
  }

  async function importQuestions(source = "collegeboard", subject = "math", pool = "main") {
    const subjectKey = normalizeSubject(subject);
    const poolKey = normalizePool(pool);
    if (source !== "collegeboard") throw new Error("Only the official College Board catalog is supported.");
    const importData = await collegeBoard.loadImportData(subjectKey);

    const importedAt = now();
    await db.transaction(async (tx) => {
      await tx.prepare(`
        UPDATE question_pool_memberships pm
        SET active = false, last_seen_at = ?
        FROM questions q, question_source_refs sr
        WHERE pm.question_row_id = q.row_id
          AND sr.question_row_id = q.row_id
          AND sr.source = 'collegeboard'
          AND q.subject = ?
          AND pm.pool = ?
      `).run(importedAt, subjectKey, poolKey);
      await upsertImportedQuestions(tx, importData.questions, {
        source: importData.source,
        subject: subjectKey,
        pool: poolKey,
        live: importData.live,
        importedAt
      });
      await setSetting(`activeSource:${subjectKey}:${poolKey}`, importData.source, tx);
    });

    return {
      source: importData.source,
      subject: subjectKey,
      pool: poolKey,
      imported: importData.questions.length,
      excludedBluebook: importData.questions.filter((question) => {
        const externalId = question.external_id || "";
        return Boolean(externalId && importData.live.has(externalId));
      }).length,
      importedAt
    };
  }

  async function getAvailableCollegeBoardQuestions(subject = "math", pool = "main") {
    return await db
      .prepare(`
        SELECT q.*
        FROM question_catalog q
        WHERE q.source = 'collegeboard'
          AND q.subject = ?
          AND q.pool = ?
          AND NOT q.excluded_bluebook
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
            WHEN qc.question_row_id IS NOT NULL
              AND (
                COALESCE(qc.data_json ->> 'stem', '') <> ''
                OR COALESCE(qc.data_json ->> 'stimulus', '') <> ''
              )
              AND jsonb_array_length(COALESCE(qc.data_json -> 'correct_answer', '[]'::jsonb)) > 0
            THEN 1
            ELSE 0
          END
        ) AS cached
      FROM question_catalog q
      LEFT JOIN question_content qc
        ON qc.question_row_id = q.row_id
      WHERE q.source = 'collegeboard'
        AND q.subject = ?
        AND q.pool = ?
        AND NOT q.excluded_bluebook
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

  return {
    activeSourceFor,
    getContentCacheStats,
    getQuestion,
    getQuestionContent,
    importNewQuestions,
    importQuestions,
    isAnsweredStatus,
    normalizePool,
    poolFromBody,
    poolFromUrl,
    publicCacheJob,
    sourceLabel,
    startCacheAllQuestions,
    subjectFromBody,
    subjectFromUrl
  };
}
