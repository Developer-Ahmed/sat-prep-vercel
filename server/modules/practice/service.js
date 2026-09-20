import { normalizeSubject, subjectConfig } from "../../subjects.js";
import { HttpError } from "../../platform/http.js";
import { gradeAnswer } from "./grading.js";
import { chooseFillableQuota, orderRealisticRows, realisticQuotaOptions } from "./module-policy.js";

export function createPracticeService({ db, currentUserId, catalog }) {
  const {
    activeSourceFor,
    getQuestionContents,
    isAnsweredStatus,
    normalizePool
  } = catalog;

  function now() {
    return new Date().toISOString();
  }

  async function getStatus(subject = "math", pool = "main") {
    const userId = currentUserId();
    const subjectKey = normalizeSubject(subject);
    const poolKey = normalizePool(pool);
    const status = await db.prepare(`
      WITH scoped AS MATERIALIZED (
        SELECT
          q.domain_desc,
          q.skill_desc,
          p.status,
          p.flagged
        FROM question_catalog q
        LEFT JOIN progress p ON p.user_id = ? AND p.row_id = q.row_id
        WHERE q.subject = ?
          AND q.pool = ?
          AND q.source = 'peak1600'
      ), summary AS (
        SELECT
          COUNT(*) AS total,
          COUNT(*) AS available,
          COUNT(*) FILTER (WHERE status IS NULL OR status IN ('unanswered', 'skipped')) AS unanswered,
          COUNT(*) FILTER (WHERE status IN ('correct', 'incorrect')) AS answered,
          COUNT(*) FILTER (WHERE status = 'correct') AS correct,
          COUNT(*) FILTER (WHERE status = 'incorrect') AS incorrect,
          COUNT(*) FILTER (WHERE COALESCE(flagged, false)) AS flagged
        FROM scoped
      ), performance AS (
        SELECT
          COALESCE(NULLIF(TRIM(domain_desc), ''), 'Math') AS domain,
          COALESCE(NULLIF(TRIM(skill_desc), ''), 'Uncategorized') AS skill,
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE status = 'correct') AS correct,
          COUNT(*) FILTER (WHERE status = 'incorrect') AS incorrect,
          COUNT(*) FILTER (WHERE status IN ('correct', 'incorrect')) AS answered
        FROM scoped
        GROUP BY
          COALESCE(NULLIF(TRIM(domain_desc), ''), 'Math'),
          COALESCE(NULLIF(TRIM(skill_desc), ''), 'Uncategorized')
      ), performance_json AS (
        SELECT COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'domain', domain,
              'skill', skill,
              'total', total,
              'correct', correct,
              'incorrect', incorrect,
              'answered', answered
            ) ORDER BY domain, skill
          ),
          '[]'::jsonb
        ) AS rows
        FROM performance
      )
      SELECT
        summary.*,
        COALESCE((SELECT value FROM app_settings WHERE key = ?), '') AS active_source,
        performance_json.rows AS performance_rows
      FROM summary
      CROSS JOIN performance_json
    `).get(userId, subjectKey, poolKey, `activeSource:${subjectKey}:${poolKey}`);
    const performanceRows = Array.isArray(status.performance_rows)
      ? status.performance_rows
      : JSON.parse(status.performance_rows || "[]");
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
          total: Number(row.total || 0),
          correct: Number(row.correct || 0),
          incorrect: Number(row.incorrect || 0),
          answered: Number(row.answered || 0)
        };
        domains[domain].correct += skill.correct;
        domains[domain].incorrect += skill.incorrect;
        domains[domain].answered += skill.answered;
        domains[domain].total += skill.total;
        domains[domain].skills.push(skill);
        return domains;
      }, {})
    ).sort((a, b) => a.domain.localeCompare(b.domain));

    return {
      total: Number(status.total || 0),
      available: Number(status.available || 0),
      unanswered: Number(status.unanswered || 0),
      answered: Number(status.answered || 0),
      correct: Number(status.correct || 0),
      incorrect: Number(status.incorrect || 0),
      flagged: Number(status.flagged || 0),
      subject: subjectKey,
      pool: poolKey,
      activeSource: status.active_source || "",
      performanceByDomain
    };
  }

  async function selectRows(where, limit, subject = "math", pool = "main") {
    const userId = currentUserId();
    return await db
      .prepare(`
        SELECT q.row_id, q.domain_desc, q.skill_desc
        FROM question_catalog q
        LEFT JOIN progress p ON p.user_id = ? AND p.row_id = q.row_id
        WHERE q.subject = ?
          AND q.pool = ?
          AND ${where}
        ORDER BY random()
        LIMIT ?
      `)
      .all(userId, normalizeSubject(subject), normalizePool(pool), limit);
  }

  async function selectOriginalDomainRows(domain, limit, excludedRowIds = [], subject = "math", pool = "main") {
    const userId = currentUserId();
    const excludeClause = excludedRowIds.length
      ? `AND q.row_id NOT IN (${excludedRowIds.map(() => "?").join(",")})`
      : "";
    return await db
      .prepare(`
        SELECT q.row_id, q.domain_desc, q.skill_desc
        FROM question_catalog q
        LEFT JOIN progress p ON p.user_id = ? AND p.row_id = q.row_id
        WHERE q.source = 'peak1600'
          AND q.subject = ?
          AND q.pool = ?
          AND TRIM(q.domain_desc) = ?
          AND (p.status IS NULL OR p.status IN ('unanswered', 'skipped'))
          ${excludeClause}
        ORDER BY random()
        LIMIT ?
      `)
      .all(userId, normalizeSubject(subject), normalizePool(pool), domain, ...excludedRowIds, limit);
  }

  async function selectOriginalAnyRows(limit, excludedRowIds = [], subject = "math", pool = "main") {
    const userId = currentUserId();
    const excludeClause = excludedRowIds.length
      ? `AND q.row_id NOT IN (${excludedRowIds.map(() => "?").join(",")})`
      : "";
    return await db
      .prepare(`
        SELECT q.row_id, q.domain_desc, q.skill_desc
        FROM question_catalog q
        LEFT JOIN progress p ON p.user_id = ? AND p.row_id = q.row_id
        WHERE q.source = 'peak1600'
          AND q.subject = ?
          AND q.pool = ?
          AND (p.status IS NULL OR p.status IN ('unanswered', 'skipped'))
          ${excludeClause}
        ORDER BY random()
        LIMIT ?
      `)
      .all(userId, normalizeSubject(subject), normalizePool(pool), ...excludedRowIds, limit);
  }

  async function getOriginalUnansweredDomainCounts(excludedRowIds = [], subject = "math", pool = "main") {
    const userId = currentUserId();
    const excludeClause = excludedRowIds.length
      ? `AND q.row_id NOT IN (${excludedRowIds.map(() => "?").join(",")})`
      : "";
    return Object.fromEntries(
      (await db
        .prepare(`
          SELECT
            COALESCE(NULLIF(TRIM(q.domain_desc), ''), 'Math') AS domain,
            COUNT(*) AS available
          FROM question_catalog q
          LEFT JOIN progress p ON p.user_id = ? AND p.row_id = q.row_id
          WHERE q.source = 'peak1600'
            AND q.subject = ?
            AND q.pool = ?
            AND (p.status IS NULL OR p.status IN ('unanswered', 'skipped'))
            ${excludeClause}
          GROUP BY COALESCE(NULLIF(TRIM(q.domain_desc), ''), 'Math')
        `)
        .all(userId, normalizeSubject(subject), normalizePool(pool), ...excludedRowIds))
        .map((row) => [row.domain, Number(row.available || 0)])
    );
  }

  async function chooseRealisticQuota(excludedRowIds = [], subject = "math", pool = "main") {
    const subjectKey = normalizeSubject(subject);
    const poolKey = normalizePool(pool);
    const quotaOptions = realisticQuotaOptions(subjectKey);
    const counts = await getOriginalUnansweredDomainCounts(excludedRowIds, subjectKey, poolKey);
    const selected = chooseFillableQuota(counts, subjectKey);
    if (!selected) {
      const domainSummary = Object.keys(quotaOptions[0])
        .map((domain) => `${domain}: ${counts[domain] || 0} unanswered`)
        .join("; ");
      throw new HttpError(409, "INSUFFICIENT_QUESTIONS", `Not enough unanswered original questions for a balanced module. ${domainSummary}.`);
    }
    return selected;
  }

  async function createModuleRecord(
    ids,
    title,
    durationMinutes = 35,
    kind = "practice",
    submittedAt = null,
    { sectionId = null, sectionOrder = null, subject = "math", pool = "main", summaryOnly = false } = {}
  ) {
    const userId = currentUserId();
    const subjectKey = normalizeSubject(subject);
    const poolKey = normalizePool(pool);
    const createdAt = now();
    const parsedMinutes = Number(durationMinutes);
    const fallbackMinutes = kind === "practice" ? 35 : 0;
    const safeMinutes = Math.max(0, Number.isFinite(parsedMinutes) ? parsedMinutes : fallbackMinutes);
    const moduleId = await db.transaction(async (tx) => {
      let sessionId = sectionId;
      if (!sessionId) {
        const sessionResult = await tx.prepare(`
          INSERT INTO test_sessions (user_id, subject, pool, kind, created_at, submitted_at)
          VALUES (?, ?, ?, ?, ?, ?)
          RETURNING id
        `).run(userId, subjectKey, poolKey, kind, createdAt, submittedAt);
        sessionId = sessionResult.lastInsertRowid;
      }

      const position = Math.max(1, Number(sectionOrder) || 1);
      const moduleResult = await tx.prepare(`
        INSERT INTO test_modules (
          user_id, session_id, position, title, duration_seconds, created_at, started_at, submitted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING id
      `).run(
        userId,
        sessionId,
        position,
        title,
        safeMinutes * 60,
        createdAt,
        position === 1 ? createdAt : null,
        submittedAt
      );
      const createdModuleId = moduleResult.lastInsertRowid;

      if (ids.length) {
        const membershipValues = ids.map(() => "(?, ?, ?, ?)").join(", ");
        const membershipArgs = ids.flatMap((rowId, index) => [userId, createdModuleId, index + 1, rowId]);
        await tx.prepare(`
          INSERT INTO module_questions (user_id, module_id, position, row_id)
          VALUES ${membershipValues}
        `).run(...membershipArgs);
      }
      return createdModuleId;
    });

    return summaryOnly ? { id: moduleId, questionIds: [...ids] } : getModule(moduleId);
  }

  async function createSectionSession(subject, pool) {
    const result = await db.prepare(`
      INSERT INTO test_sessions (user_id, subject, pool, kind, created_at)
      VALUES (?, ?, ?, 'practice', ?)
      RETURNING id
    `).run(currentUserId(), normalizeSubject(subject), normalizePool(pool), now());
    return result.lastInsertRowid;
  }

  async function createRealisticModule({ sectionId = null, sectionOrder = null, excludedRowIds = [], quota = null, subject = "math", pool = "main" } = {}) {
    const subjectKey = normalizeSubject(subject);
    const poolKey = normalizePool(pool);
    const config = subjectConfig(subjectKey);
    if ((await activeSourceFor(subjectKey, poolKey)) !== "peak1600") {
      throw new HttpError(409, "CATALOG_NOT_READY", "The PEAK1600 original question bank has not been seeded.");
    }
    const selectedQuota = quota || await chooseRealisticQuota(excludedRowIds, subjectKey, poolKey);
    const rows = (await Promise.all(Object.entries(selectedQuota).map(([domain, limit]) =>
      selectOriginalDomainRows(domain, limit, excludedRowIds, subjectKey, poolKey)
    ))).flat();
    if (rows.length !== config.defaultCount) {
      throw new HttpError(409, "INSUFFICIENT_QUESTIONS", "Could not create a balanced module from the available unanswered original questions.");
    }
    const orderedRows = orderRealisticRows(rows, subjectKey);
    return createModuleRecord(
      orderedRows.map((row) => row.row_id),
      sectionId ? `${config.label} section module ${sectionOrder} of 2` : `${config.defaultCount}-question balanced ${config.label} module`,
      config.defaultMinutes,
      "practice",
      null,
      { sectionId, sectionOrder, subject: subjectKey, pool: poolKey }
    );
  }

  async function createFlexibleSectionModule({ sectionId, sectionOrder, excludedRowIds = [], quota, subject = "math", pool = "main", summaryOnly = false }) {
    const subjectKey = normalizeSubject(subject);
    const poolKey = normalizePool(pool);
    const config = subjectConfig(subjectKey);
    const rows = (await Promise.all(Object.entries(quota).map(([domain, limit]) =>
      selectOriginalDomainRows(domain, limit, excludedRowIds, subjectKey, poolKey)
    ))).flat();

    const missing = config.defaultCount - rows.length;
    if (missing > 0) {
      rows.push(...await selectOriginalAnyRows(missing, [...excludedRowIds, ...rows.map((row) => row.row_id)], subjectKey, poolKey));
    }

    if (rows.length !== config.defaultCount) {
      throw new HttpError(409, "INSUFFICIENT_QUESTIONS", `Could not create a full ${config.label} section module from the available unanswered original questions.`);
    }

    const orderedRows = orderRealisticRows(rows, subjectKey);
    return createModuleRecord(
      orderedRows.map((row) => row.row_id),
      `${config.label} section module ${sectionOrder} of 2`,
      config.defaultMinutes,
      "practice",
      null,
      { sectionId, sectionOrder, subject: subjectKey, pool: poolKey, summaryOnly }
    );
  }

  async function createModule({ count = 22, includeAnswered = false, durationMinutes = 35, mode = "random", subject = "math", pool = "main" }) {
    const subjectKey = normalizeSubject(subject);
    const poolKey = normalizePool(pool);
    const config = subjectConfig(subjectKey);
    if (mode === "realistic") return createRealisticModule({ subject: subjectKey, pool: poolKey });
    if (mode === "section") return createSection(subjectKey, poolKey);
    const limit = Math.max(1, Math.min(Number(count) || config.defaultCount, 98));
    const where = includeAnswered
      ? "q.source = 'peak1600'"
      : "q.source = 'peak1600' AND (p.status IS NULL OR p.status IN ('unanswered', 'skipped'))";
    const rows = await selectRows(where, limit, subjectKey, poolKey);

    if (!rows.length) {
      throw new HttpError(409, "NO_ELIGIBLE_QUESTIONS", "No eligible original questions were found. Include answered questions or reseed the question bank.");
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
    if ((await activeSourceFor(subjectKey, poolKey)) !== "peak1600") {
      throw new HttpError(409, "CATALOG_NOT_READY", "The PEAK1600 original question bank has not been seeded.");
    }
    const sectionId = await createSectionSession(subjectKey, poolKey);
    const quotaOptions = realisticQuotaOptions(subjectKey);
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
        pool: poolKey,
        summaryOnly: true
      });
      return {
        ...first,
        next_section_module_id: second.id
      };
    } catch (error) {
      await db.prepare("DELETE FROM test_sessions WHERE id = ? AND user_id = ?").run(sectionId, currentUserId());
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
        where: "q.source = 'peak1600' AND p.status = 'incorrect'"
      },
      flagged: {
        title: "Flagged question review",
        where: "q.source = 'peak1600' AND COALESCE(p.flagged, false)"
      }
    };
    const config = reviewModes[mode];
    if (!config) throw new HttpError(400, "INVALID_REVIEW_MODE", "Unknown review mode.");

    const rows = await selectRows(config.where, limit, subjectKey, poolKey);
    if (!rows.length) throw new HttpError(409, "NO_REVIEW_QUESTIONS", `No ${mode} questions found yet.`);

    const ids = rows.map((row) => row.row_id);
    return createModuleRecord(ids, `${config.title} (${ids.length})`, durationMinutes, `review_${mode}`, now(), {
      subject: subjectKey,
      pool: poolKey
    });
  }

  async function listModules(subject = "math", pool = "main") {
    const userId = currentUserId();
    return (await db
      .prepare(`
        SELECT
          m.id,
          m.title,
          m.created_at,
          m.submitted_at,
          COUNT(DISTINCT mq.row_id) AS question_count,
          COUNT(*) FILTER (WHERE mq.status = 'correct') AS correct,
          COUNT(*) FILTER (WHERE mq.status = 'incorrect') AS incorrect,
          COUNT(*) FILTER (WHERE mq.status = 'skipped') AS skipped,
          COUNT(*) FILTER (WHERE mq.flagged) AS flagged
        FROM test_modules m
        JOIN test_sessions s ON s.user_id = m.user_id AND s.id = m.session_id
        LEFT JOIN module_questions mq ON mq.user_id = m.user_id AND mq.module_id = m.id
        WHERE s.kind = 'practice'
          AND s.user_id = ?
          AND s.subject = ?
          AND s.pool = ?
        GROUP BY m.id, m.title, m.created_at, m.submitted_at
        ORDER BY m.created_at DESC
        LIMIT 12
      `)
      .all(userId, normalizeSubject(subject), normalizePool(pool)))
      .map((row) => ({
        ...row,
        question_count: Number(row.question_count || 0),
        correct: Number(row.correct || 0),
        incorrect: Number(row.incorrect || 0),
        skipped: Number(row.skipped || 0),
        flagged: Number(row.flagged || 0)
      }));
  }

  async function getModule(moduleId) {
    const userId = currentUserId();
    const module = await db.prepare(`
      SELECT
        m.id,
        m.title,
        m.duration_seconds,
        m.created_at,
        m.started_at,
        m.submitted_at,
        s.kind,
        s.subject,
        s.pool,
        s.id AS section_id,
        m.position AS section_order
      FROM test_modules m
      JOIN test_sessions s ON s.user_id = m.user_id AND s.id = m.session_id
      WHERE m.id = ? AND m.user_id = ?
    `).get(moduleId, userId);
    if (!module) return null;
    const [questionRows, timeSegments, nextSectionModule] = await Promise.all([
      db.prepare(`
        SELECT q.row_id, q.source, q.subject, q.question_id, q.domain_desc,
               q.skill_desc, q.difficulty, COALESCE(p.flagged, false) AS flagged,
               p.status, mq.answer, mq.flagged AS module_flagged, mq.is_correct,
               mq.time_spent_seconds,
               mq.position, qc.data_json AS cached_data_json
        FROM module_questions mq
        JOIN question_catalog q ON q.row_id = mq.row_id AND q.pool = ?
        LEFT JOIN question_content qc ON qc.question_row_id = q.row_id
        LEFT JOIN progress p ON p.user_id = mq.user_id AND p.row_id = mq.row_id
        WHERE mq.user_id = ? AND mq.module_id = ?
        ORDER BY mq.position
      `).all(module.pool, userId, moduleId),
      db.prepare(`
        SELECT row_id, pass_index, seconds
        FROM response_time_segments
        WHERE user_id = ? AND module_id = ?
        ORDER BY row_id, pass_index
      `).all(userId, moduleId),
      db.prepare(`
        SELECT id
        FROM test_modules
        WHERE user_id = ? AND session_id = ? AND position = ?
        LIMIT 1
      `).get(userId, module.section_id, Number(module.section_order || 0) + 1)
    ]);
    const segmentsById = new Map();
    for (const segment of timeSegments) {
      if (!segmentsById.has(segment.row_id)) segmentsById.set(segment.row_id, []);
      segmentsById.get(segment.row_id).push({
        pass_index: Number(segment.pass_index) || 0,
        seconds: Number(segment.seconds) || 0
      });
    }
    const ids = questionRows.map((row) => row.row_id);
    const contentByRowId = await getQuestionContents(questionRows);
    const publicQuestionRows = questionRows.map(({ cached_data_json: _cachedDataJson, ...row }) => row);
    const questionDetails = {};
    let detailBytes = 0;
    const maxEmbeddedDetailBytes = 3 * 1024 * 1024;
    for (const row of publicQuestionRows) {
      const detail = { content: contentByRowId.get(row.row_id) };
      const bytes = Buffer.byteLength(JSON.stringify(detail));
      if (detailBytes + bytes > maxEmbeddedDetailBytes) continue;
      questionDetails[row.row_id] = detail;
      detailBytes += bytes;
    }
    const result = {
      ...module,
      next_section_module_id: nextSectionModule?.id || null,
      questionIds: ids,
      questions: publicQuestionRows.map((row) => ({ ...row, time_segments: segmentsById.get(row.row_id) || [] })),
      questionDetails
    };
    Object.defineProperty(result, "allQuestionContents", { value: contentByRowId });
    return result;
  }

  async function requireOwnedModuleQuestion(moduleId, rowId = null, database = db, { lock = false } = {}) {
    const userId = currentUserId();
    const module = await database
      .prepare(`
        SELECT id, session_id, position, submitted_at
        FROM test_modules
        WHERE id = ? AND user_id = ?
        ${lock ? "FOR UPDATE" : ""}
      `)
      .get(moduleId, userId);
    if (!module) {
      const error = new Error("Module not found.");
      error.statusCode = 404;
      error.code = "MODULE_NOT_FOUND";
      throw error;
    }
    const membership = rowId
      ? await database.prepare(`
          SELECT 1
          FROM module_questions
          WHERE user_id = ? AND module_id = ? AND row_id = ?
        `).get(userId, moduleId, rowId)
      : true;
    if (!membership) {
      const error = new Error("Question is not part of this module.");
      error.statusCode = 400;
      error.code = "QUESTION_NOT_IN_MODULE";
      throw error;
    }
    return module;
  }

  async function saveDraftAnswer(moduleId, rowId, answer, flagged) {
    const userId = currentUserId();
    const updatedAt = now();
    const result = await db.prepare(`
      WITH editable_module AS (
        SELECT m.id
        FROM test_modules m
        JOIN module_questions mq
          ON mq.user_id = m.user_id
          AND mq.module_id = m.id
          AND mq.row_id = ?
        WHERE m.id = ?
          AND m.user_id = ?
          AND m.submitted_at IS NULL
        FOR UPDATE OF m
      ), question_write AS (
        UPDATE module_questions mq
        SET answer = ?, updated_at = ?
        FROM editable_module editable
        WHERE mq.user_id = ?
          AND mq.module_id = editable.id
          AND mq.row_id = ?
        RETURNING mq.user_id, mq.row_id
      ), progress_write AS (
        INSERT INTO progress (user_id, row_id, status, flagged, updated_at)
        SELECT user_id, row_id, 'unanswered', ?, ?
        FROM question_write
        ON CONFLICT(user_id, row_id) DO UPDATE SET
          updated_at = excluded.updated_at
        RETURNING 1
      )
      SELECT
        EXISTS (SELECT 1 FROM question_write)
        AND EXISTS (SELECT 1 FROM progress_write) AS saved
    `).get(
      rowId,
      moduleId,
      userId,
      answer ?? "",
      updatedAt,
      userId,
      rowId,
      Boolean(flagged),
      updatedAt
    );
    if (!result?.saved) {
      throw new HttpError(409, "MODULE_NOT_EDITABLE", "This question can no longer be changed.");
    }
  }

  async function saveFlag(moduleId, rowId, flagged) {
    const userId = currentUserId();
    const updatedAt = now();
    const result = await db.prepare(`
      WITH editable_module AS (
        SELECT m.id
        FROM test_modules m
        JOIN module_questions mq
          ON mq.user_id = m.user_id
          AND mq.module_id = m.id
          AND mq.row_id = ?
        WHERE m.id = ?
          AND m.user_id = ?
          AND m.submitted_at IS NULL
        FOR UPDATE OF m
      ), question_write AS (
        UPDATE module_questions mq
        SET flagged = ?, updated_at = ?
        FROM editable_module editable
        WHERE mq.user_id = ?
          AND mq.module_id = editable.id
          AND mq.row_id = ?
        RETURNING mq.user_id, mq.row_id
      ), progress_write AS (
        INSERT INTO progress (user_id, row_id, status, flagged, updated_at)
        SELECT user_id, row_id, 'unanswered', ?, ?
        FROM question_write
        ON CONFLICT(user_id, row_id) DO UPDATE SET
          flagged = excluded.flagged,
          updated_at = excluded.updated_at
        RETURNING 1
      )
      SELECT
        EXISTS (SELECT 1 FROM question_write)
        AND EXISTS (SELECT 1 FROM progress_write) AS saved
    `).get(
      rowId,
      moduleId,
      userId,
      Boolean(flagged),
      updatedAt,
      userId,
      rowId,
      Boolean(flagged),
      updatedAt
    );
    if (!result?.saved) {
      throw new HttpError(409, "MODULE_NOT_EDITABLE", "This question can no longer be changed.");
    }
  }

  async function saveQuestionTime(moduleId, rowId, timeSpentSeconds, passIndex, passSeconds) {
    const userId = currentUserId();
    const safeSeconds = Math.max(0, Math.floor(Number(timeSpentSeconds) || 0));
    const safePassIndex = Math.max(0, Math.floor(Number(passIndex) || 0));
    const safePassSeconds = Math.max(0, Math.floor(Number(passSeconds) || 0));
    const updatedAt = now();
    await db.prepare(`
      WITH editable_module AS (
        SELECT m.id
        FROM test_modules m
        JOIN module_questions mq
          ON mq.user_id = m.user_id
          AND mq.module_id = m.id
          AND mq.row_id = ?
        WHERE m.id = ?
          AND m.user_id = ?
          AND m.submitted_at IS NULL
        FOR UPDATE OF m
      ), question_write AS (
        UPDATE module_questions mq
        SET
          time_spent_seconds = GREATEST(mq.time_spent_seconds, ?),
          updated_at = ?
        FROM editable_module editable
        WHERE mq.user_id = ?
          AND mq.module_id = editable.id
          AND mq.row_id = ?
        RETURNING 1
      ), segment_write AS (
        INSERT INTO response_time_segments (user_id, module_id, row_id, pass_index, seconds, updated_at)
        SELECT ?, ?, ?, ?, ?, ?
        FROM editable_module
        WHERE ? > 0 AND ? > 0
        ON CONFLICT(user_id, module_id, row_id, pass_index) DO UPDATE SET
          seconds = GREATEST(response_time_segments.seconds, excluded.seconds),
          updated_at = excluded.updated_at
        RETURNING 1
      )
      SELECT EXISTS (SELECT 1 FROM question_write) AS saved
    `).get(
      rowId,
      moduleId,
      userId,
      safeSeconds,
      updatedAt,
      userId,
      rowId,
      userId,
      moduleId,
      rowId,
      safePassIndex,
      safePassSeconds,
      updatedAt,
      safePassIndex,
      safePassSeconds
    );
  }

  async function clearIncorrectQuestion(rowId) {
    await db.prepare(`
      UPDATE progress
      SET status = 'unanswered',
          selected_answer = NULL,
          answered_at = NULL,
          updated_at = ?
      WHERE user_id = ? AND row_id = ? AND status = 'incorrect'
    `).run(now(), currentUserId(), rowId);
  }

  async function submitModule(moduleId) {
    const userId = currentUserId();
    const moduleSnapshot = await getModule(moduleId);
    if (!moduleSnapshot) throw new HttpError(404, "MODULE_NOT_FOUND", "Module not found.");
    if (moduleSnapshot.submitted_at) return moduleSnapshot;
    const contentByRowId = moduleSnapshot.allQuestionContents
      || new Map(moduleSnapshot.questions.map((question) => [
        question.row_id,
        moduleSnapshot.questionDetails?.[question.row_id]?.content
      ]));
    const submittedAt = now();
    let gradedQuestions = [];
    const outcome = await db.transaction(async (tx) => {
      const lockedRows = await tx.prepare(`
        SELECT
          m.session_id,
          m.position,
          m.submitted_at,
          mq.row_id,
          mq.answer,
          mq.flagged
        FROM test_modules m
        LEFT JOIN module_questions mq
          ON mq.user_id = m.user_id AND mq.module_id = m.id
        WHERE m.id = ? AND m.user_id = ?
        ORDER BY mq.position
        FOR UPDATE OF m
      `).all(moduleId, userId);
      const lockedModule = lockedRows[0];
      if (!lockedModule) throw new HttpError(404, "MODULE_NOT_FOUND", "Module not found.");
      if (lockedModule.submitted_at) return { alreadySubmitted: true, nextModuleId: null };

      const responsesById = new Map(lockedRows.map((row) => [row.row_id, row]));
      const graded = moduleSnapshot.questions.map((question) => {
        const response = responsesById.get(question.row_id);
        const answer = response?.answer || "";
        return {
          question,
          answer,
          flagged: Boolean(response?.flagged),
          grade: gradeAnswer(contentByRowId.get(question.row_id), answer)
        };
      });
      gradedQuestions = graded;

      const questionValues = graded
        .map(() => "(?::text, ?::bigint, ?::text, ?::text, ?::boolean, ?::text, ?::boolean, ?::timestamptz)")
        .join(", ");
      const questionArgs = graded.flatMap(({ question, answer, flagged, grade }) => [
        userId,
        moduleId,
        question.row_id,
        answer,
        flagged,
        grade.status,
        grade.isCorrect,
        submittedAt
      ]);
      const progressValues = graded.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(", ");
      const progressArgs = graded.flatMap(({ question, answer, flagged, grade }) => [
        userId,
        question.row_id,
        grade.status,
        flagged,
        answer,
        isAnsweredStatus(grade.status) ? submittedAt : null,
        submittedAt
      ]);
      const finalized = await tx.prepare(`
        WITH graded_values(user_id, module_id, row_id, answer, flagged, status, is_correct, updated_at) AS (
          VALUES ${questionValues}
        ), question_write AS (
          UPDATE module_questions mq
          SET
            answer = graded.answer,
            flagged = graded.flagged,
            status = graded.status,
            is_correct = graded.is_correct,
            updated_at = graded.updated_at
          FROM graded_values graded
          WHERE mq.user_id = graded.user_id
            AND mq.module_id = graded.module_id
            AND mq.row_id = graded.row_id
          RETURNING 1
        ), progress_write AS (
          INSERT INTO progress (user_id, row_id, status, flagged, selected_answer, answered_at, updated_at)
          VALUES ${progressValues}
          ON CONFLICT(user_id, row_id) DO UPDATE SET
            status = excluded.status,
            flagged = excluded.flagged,
            selected_answer = excluded.selected_answer,
            answered_at = excluded.answered_at,
            updated_at = excluded.updated_at
          RETURNING 1
        ), submitted_module AS (
          UPDATE test_modules
          SET submitted_at = ?
          WHERE id = ? AND user_id = ? AND submitted_at IS NULL
          RETURNING session_id, position
        ), next_module AS MATERIALIZED (
          SELECT following.id
          FROM test_modules following
          JOIN submitted_module submitted
            ON following.session_id = submitted.session_id AND following.position = submitted.position + 1
          WHERE following.user_id = ? AND following.submitted_at IS NULL
          LIMIT 1
        ), next_write AS (
          UPDATE test_modules following
          SET started_at = COALESCE(following.started_at, ?)
          FROM next_module target
          WHERE following.id = target.id AND following.user_id = ?
          RETURNING following.id
        ), session_write AS (
          UPDATE test_sessions completed_session
          SET submitted_at = ?
          FROM submitted_module submitted
          WHERE completed_session.id = submitted.session_id
            AND completed_session.user_id = ?
            AND NOT EXISTS (SELECT 1 FROM next_module)
          RETURNING completed_session.id
        )
        SELECT
          (SELECT id FROM next_module) AS next_module_id,
          (SELECT COUNT(*) FROM question_write) AS question_count,
          (SELECT COUNT(*) FROM progress_write) AS progress_count,
          EXISTS (SELECT 1 FROM submitted_module) AS submitted
      `).get(
        ...questionArgs,
        ...progressArgs,
        submittedAt,
        moduleId,
        userId,
        userId,
        submittedAt,
        userId,
        submittedAt,
        userId
      );
      if (
        !finalized?.submitted
        || Number(finalized.question_count) !== graded.length
        || Number(finalized.progress_count) !== graded.length
      ) {
        throw new HttpError(409, "MODULE_NOT_EDITABLE", "This module can no longer be submitted.");
      }
      return { alreadySubmitted: false, nextModuleId: finalized.next_module_id || null };
    });

    if (outcome.alreadySubmitted) return getModule(moduleId);
    const gradedByRowId = new Map(gradedQuestions.map((result) => [result.question.row_id, result]));
    return {
      ...moduleSnapshot,
      submitted_at: submittedAt,
      next_section_module_id: outcome.nextModuleId,
      questions: moduleSnapshot.questions.map((question) => {
        const result = gradedByRowId.get(question.row_id);
        if (!result) return question;
        return {
          ...question,
          answer: result.answer,
          module_flagged: result.flagged,
          status: result.grade.status,
          is_correct: result.grade.isCorrect
        };
      })
    };
  }

  return {
    clearIncorrectQuestion,
    createModule,
    createReviewModule,
    getModule,
    getStatus,
    listModules,
    saveDraftAnswer,
    saveFlag,
    saveQuestionTime,
    submitModule
  };
}
