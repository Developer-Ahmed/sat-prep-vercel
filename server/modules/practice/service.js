import { normalizeSubject, subjectConfig } from "../../subjects.js";
import { HttpError } from "../../platform/http.js";
import { gradeAnswer } from "./grading.js";
import { chooseFillableQuota, orderRealisticRows, realisticQuotaOptions } from "./module-policy.js";

export function createPracticeService({ db, currentUserId, catalog, isAdmin }) {
  const {
    activeSourceFor,
    getContentCacheStats,
    getQuestionContent,
    isAnsweredStatus,
    normalizePool,
    sourceLabel
  } = catalog;

  function now() {
    return new Date().toISOString();
  }

  async function getStatus(subject = "math", pool = "main") {
    const userId = currentUserId();
    const subjectKey = normalizeSubject(subject);
    const poolKey = normalizePool(pool);
    const counts = await db.prepare(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE excluded_bluebook) AS excluded,
        COUNT(*) FILTER (WHERE NOT excluded_bluebook) AS available,
        COUNT(*) FILTER (WHERE NOT excluded_bluebook AND (p.status IS NULL OR p.status IN ('unanswered', 'skipped'))) AS unanswered,
        COUNT(*) FILTER (WHERE NOT excluded_bluebook AND p.status IN ('correct', 'incorrect')) AS answered,
        COUNT(*) FILTER (WHERE NOT excluded_bluebook AND p.status = 'correct') AS correct,
        COUNT(*) FILTER (WHERE NOT excluded_bluebook AND p.status = 'incorrect') AS incorrect,
        COUNT(*) FILTER (WHERE NOT excluded_bluebook AND COALESCE(p.flagged, false)) AS flagged
      FROM question_catalog q
      LEFT JOIN progress p ON p.user_id = ? AND p.row_id = q.row_id
      WHERE q.subject = ?
        AND q.pool = ?
    `).get(userId, subjectKey, poolKey);

    const lastImport = await db
      .prepare("SELECT MAX(imported_at) AS imported_at FROM question_catalog WHERE subject = ? AND pool = ?")
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
        FROM question_catalog q
        LEFT JOIN progress p ON p.user_id = ? AND p.row_id = q.row_id
        WHERE NOT q.excluded_bluebook
          AND q.subject = ?
          AND q.pool = ?
        GROUP BY
          COALESCE(NULLIF(TRIM(q.domain_desc), ''), 'Math'),
          COALESCE(NULLIF(TRIM(q.skill_desc), ''), 'Uncategorized')
        ORDER BY domain, skill
      `)
      .all(userId, subjectKey, poolKey);
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

    const activeSource = await activeSourceFor(subjectKey, poolKey);
    return {
      ...counts,
      total: Number(counts.total || 0),
      excluded: Number(counts.excluded || 0),
      available: Number(counts.available || 0),
      unanswered: Number(counts.unanswered || 0),
      answered: Number(counts.answered || 0),
      correct: Number(counts.correct || 0),
      incorrect: Number(counts.incorrect || 0),
      flagged: Number(counts.flagged || 0),
      subject: subjectKey,
      pool: poolKey,
      activeSource,
      activeSourceLabel: sourceLabel(activeSource),
      lastImport: lastImport.imported_at || null,
      contentCache,
      performanceByDomain,
      canManageCatalog: isAdmin(userId)
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

  async function selectCollegeBoardDomainRows(domain, limit, excludedRowIds = [], subject = "math", pool = "main") {
    const userId = currentUserId();
    const excludeClause = excludedRowIds.length
      ? `AND q.row_id NOT IN (${excludedRowIds.map(() => "?").join(",")})`
      : "";
    return await db
      .prepare(`
        SELECT q.row_id, q.domain_desc, q.skill_desc
        FROM question_catalog q
        LEFT JOIN progress p ON p.user_id = ? AND p.row_id = q.row_id
        WHERE q.source = 'collegeboard'
          AND q.subject = ?
          AND q.pool = ?
          AND NOT q.excluded_bluebook
          AND TRIM(q.domain_desc) = ?
          AND (p.status IS NULL OR p.status IN ('unanswered', 'skipped'))
          ${excludeClause}
        ORDER BY random()
        LIMIT ?
      `)
      .all(userId, normalizeSubject(subject), normalizePool(pool), domain, ...excludedRowIds, limit);
  }

  async function selectCollegeBoardAnyRows(limit, excludedRowIds = [], subject = "math", pool = "main") {
    const userId = currentUserId();
    const excludeClause = excludedRowIds.length
      ? `AND q.row_id NOT IN (${excludedRowIds.map(() => "?").join(",")})`
      : "";
    return await db
      .prepare(`
        SELECT q.row_id, q.domain_desc, q.skill_desc
        FROM question_catalog q
        LEFT JOIN progress p ON p.user_id = ? AND p.row_id = q.row_id
        WHERE q.source = 'collegeboard'
          AND q.subject = ?
          AND q.pool = ?
          AND NOT q.excluded_bluebook
          AND (p.status IS NULL OR p.status IN ('unanswered', 'skipped'))
          ${excludeClause}
        ORDER BY random()
        LIMIT ?
      `)
      .all(userId, normalizeSubject(subject), normalizePool(pool), ...excludedRowIds, limit);
  }

  async function selectCollegeBoardDifficultyRows(difficulties, limit, excludedRowIds = [], subject = "math", pool = "main") {
    const userId = currentUserId();
    const safeDifficulties = difficulties.map((difficulty) => String(difficulty).toUpperCase()).filter(Boolean);
    if (!safeDifficulties.length) return [];
    const excludeClause = excludedRowIds.length
      ? `AND q.row_id NOT IN (${excludedRowIds.map(() => "?").join(",")})`
      : "";
    return await db
      .prepare(`
        SELECT q.row_id, q.domain_desc, q.skill_desc
        FROM question_catalog q
        LEFT JOIN progress p ON p.user_id = ? AND p.row_id = q.row_id
        WHERE q.source = 'collegeboard'
          AND q.subject = ?
          AND q.pool = ?
          AND NOT q.excluded_bluebook
          AND UPPER(TRIM(q.difficulty)) IN (${safeDifficulties.map(() => "?").join(",")})
          AND (p.status IS NULL OR p.status IN ('unanswered', 'skipped'))
          ${excludeClause}
        ORDER BY random()
        LIMIT ?
      `)
      .all(userId, normalizeSubject(subject), normalizePool(pool), ...safeDifficulties, ...excludedRowIds, limit);
  }

  async function getCollegeBoardUnansweredDomainCounts(excludedRowIds = [], subject = "math", pool = "main") {
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
          WHERE q.source = 'collegeboard'
            AND q.subject = ?
            AND q.pool = ?
            AND NOT q.excluded_bluebook
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
    const counts = await getCollegeBoardUnansweredDomainCounts(excludedRowIds, subjectKey, poolKey);
    const selected = chooseFillableQuota(counts, subjectKey);
    if (!selected) {
      const domainSummary = Object.keys(quotaOptions[0])
        .map((domain) => `${domain}: ${counts[domain] || 0} unanswered`)
        .join("; ");
      throw new HttpError(409, "INSUFFICIENT_QUESTIONS", `Not enough unanswered College Board questions for a realistic module. ${domainSummary}.`);
    }
    return selected;
  }

  async function createModuleRecord(
    ids,
    title,
    durationMinutes = 35,
    kind = "practice",
    submittedAt = null,
    { sectionId = null, sectionOrder = null, subject = "math", pool = "main" } = {}
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

    return getModule(moduleId);
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
    if ((await activeSourceFor(subjectKey, poolKey)) !== "collegeboard") {
      throw new HttpError(409, "CATALOG_NOT_READY", "Realistic SAT mode only works with the College Board official import.");
    }
    const selectedQuota = quota || await chooseRealisticQuota(excludedRowIds, subjectKey, poolKey);
    const rows = (await Promise.all(Object.entries(selectedQuota).map(([domain, limit]) =>
      selectCollegeBoardDomainRows(domain, limit, excludedRowIds, subjectKey, poolKey)
    ))).flat();
    if (rows.length !== config.defaultCount) {
      throw new HttpError(409, "INSUFFICIENT_QUESTIONS", "Could not create a realistic module from the available unanswered College Board questions.");
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
      throw new HttpError(409, "INSUFFICIENT_QUESTIONS", `Could not create a full ${config.label} section module from the available unanswered College Board questions.`);
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
      throw new HttpError(409, "INSUFFICIENT_QUESTIONS", `Could not create adaptive ${config.label} module ${sectionOrder}; not enough unanswered ${difficulties.join("/")} new questions.`);
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
      ? "NOT q.excluded_bluebook"
      : "NOT q.excluded_bluebook AND (p.status IS NULL OR p.status IN ('unanswered', 'skipped'))";
    const rows = await selectRows(where, limit, subjectKey, poolKey);

    if (!rows.length) {
      throw new HttpError(409, "NO_ELIGIBLE_QUESTIONS", "No eligible questions found. Import questions or include answered questions.");
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
      throw new HttpError(409, "CATALOG_NOT_READY", "Section mode only works with the College Board official import.");
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
        pool: poolKey
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

  async function createAdaptiveSection(subject = "math", pool = "new") {
    const subjectKey = normalizeSubject(subject);
    const poolKey = normalizePool(pool);
    if (poolKey !== "new") {
      throw new HttpError(400, "INVALID_PRACTICE_MODE", "Adaptive new-question sections are only available in the New Questions tab.");
    }
    if ((await activeSourceFor(subjectKey, poolKey)) !== "collegeboard") {
      throw new HttpError(409, "CATALOG_NOT_READY", "Import new College Board questions before creating an adaptive section.");
    }

    const sectionId = await createSectionSession(subjectKey, poolKey);
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
        where: "NOT q.excluded_bluebook AND p.status = 'incorrect'"
      },
      flagged: {
        title: "Flagged question review",
        where: "NOT q.excluded_bluebook AND COALESCE(p.flagged, false)"
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
          COUNT(*) FILTER (WHERE mr.status = 'correct') AS correct,
          COUNT(*) FILTER (WHERE mr.status = 'incorrect') AS incorrect,
          COUNT(*) FILTER (WHERE mr.status = 'skipped') AS skipped,
          COUNT(*) FILTER (WHERE mr.flagged) AS flagged
        FROM test_modules m
        JOIN test_sessions s ON s.user_id = m.user_id AND s.id = m.session_id
        LEFT JOIN module_questions mq ON mq.user_id = m.user_id AND mq.module_id = m.id
        LEFT JOIN module_responses mr
          ON mr.user_id = mq.user_id AND mr.module_id = mq.module_id AND mr.row_id = mq.row_id
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
    const questionRows = await db.prepare(`
      SELECT q.row_id, q.source, q.subject, q.question_id, q.uid, q.external_id, q.ibn, q.domain_desc,
             q.skill_desc, q.difficulty, COALESCE(p.flagged, false) AS flagged,
             p.status, mr.answer, mr.flagged AS module_flagged, mr.is_correct,
             COALESCE(mr.time_spent_seconds, 0) AS time_spent_seconds,
             mq.position
      FROM module_questions mq
      JOIN question_catalog q ON q.row_id = mq.row_id AND q.pool = ?
      LEFT JOIN progress p ON p.user_id = mq.user_id AND p.row_id = mq.row_id
      LEFT JOIN module_responses mr
        ON mr.user_id = mq.user_id AND mr.module_id = mq.module_id AND mr.row_id = mq.row_id
      WHERE mq.user_id = ? AND mq.module_id = ?
      ORDER BY mq.position
    `).all(module.pool, userId, moduleId);
    const timeSegments = await db.prepare(`
      SELECT row_id, pass_index, seconds
      FROM response_time_segments
      WHERE user_id = ? AND module_id = ?
      ORDER BY row_id, pass_index
    `).all(userId, moduleId);
    const segmentsById = new Map();
    for (const segment of timeSegments) {
      if (!segmentsById.has(segment.row_id)) segmentsById.set(segment.row_id, []);
      segmentsById.get(segment.row_id).push({
        pass_index: Number(segment.pass_index) || 0,
        seconds: Number(segment.seconds) || 0
      });
    }
    const nextSectionModule = await db.prepare(`
      SELECT id
      FROM test_modules
      WHERE user_id = ? AND session_id = ? AND position = ?
      LIMIT 1
    `).get(userId, module.section_id, Number(module.section_order || 0) + 1);
    const ids = questionRows.map((row) => row.row_id);
    return {
      ...module,
      next_section_module_id: nextSectionModule?.id || null,
      questionIds: ids,
      questions: questionRows.map((row) => ({ ...row, time_segments: segmentsById.get(row.row_id) || [] }))
    };
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
    await db.transaction(async (tx) => {
      const module = await requireOwnedModuleQuestion(moduleId, rowId, tx, { lock: true });
      if (module.submitted_at) throw new HttpError(409, "MODULE_ALREADY_SUBMITTED", "Submitted modules cannot be changed.");
      const updatedAt = now();
      await tx.prepare(`
        INSERT INTO module_responses (user_id, module_id, row_id, answer, flagged, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, module_id, row_id) DO UPDATE SET
          answer = excluded.answer,
          flagged = excluded.flagged,
          updated_at = excluded.updated_at
      `).run(userId, moduleId, rowId, answer ?? "", Boolean(flagged), updatedAt);

      await tx.prepare(`
        INSERT INTO progress (user_id, row_id, status, flagged, updated_at)
        VALUES (?, ?, 'unanswered', ?, ?)
        ON CONFLICT(user_id, row_id) DO UPDATE SET
          flagged = excluded.flagged,
          updated_at = excluded.updated_at
    `).run(userId, rowId, Boolean(flagged), updatedAt);
    });
  }

  async function saveFlag(moduleId, rowId, flagged) {
    const userId = currentUserId();
    await db.transaction(async (tx) => {
      const module = await requireOwnedModuleQuestion(moduleId, rowId, tx, { lock: true });
      if (module.submitted_at) throw new HttpError(409, "MODULE_ALREADY_SUBMITTED", "Submitted modules cannot be changed.");
      const updatedAt = now();
      await tx.prepare(`
        INSERT INTO module_responses (user_id, module_id, row_id, answer, flagged, updated_at)
        VALUES (?, ?, ?, '', ?, ?)
        ON CONFLICT(user_id, module_id, row_id) DO UPDATE SET
          flagged = excluded.flagged,
          updated_at = excluded.updated_at
      `).run(userId, moduleId, rowId, Boolean(flagged), updatedAt);

      await tx.prepare(`
        INSERT INTO progress (user_id, row_id, status, flagged, updated_at)
        VALUES (?, ?, 'unanswered', ?, ?)
        ON CONFLICT(user_id, row_id) DO UPDATE SET
          flagged = excluded.flagged,
          updated_at = excluded.updated_at
      `).run(userId, rowId, Boolean(flagged), updatedAt);
    });
  }

  async function saveQuestionTime(moduleId, rowId, timeSpentSeconds, passIndex, passSeconds) {
    const userId = currentUserId();
    const safeSeconds = Math.max(0, Math.floor(Number(timeSpentSeconds) || 0));
    const safePassIndex = Math.max(0, Math.floor(Number(passIndex) || 0));
    const safePassSeconds = Math.max(0, Math.floor(Number(passSeconds) || 0));
    await db.transaction(async (tx) => {
      const module = await requireOwnedModuleQuestion(moduleId, rowId, tx, { lock: true });
      if (module.submitted_at) return;
      const updatedAt = now();
      await tx.prepare(`
        INSERT INTO module_responses (user_id, module_id, row_id, answer, flagged, time_spent_seconds, updated_at)
        VALUES (?, ?, ?, '', false, ?, ?)
        ON CONFLICT(user_id, module_id, row_id) DO UPDATE SET
          time_spent_seconds = GREATEST(module_responses.time_spent_seconds, excluded.time_spent_seconds),
          updated_at = excluded.updated_at
      `).run(userId, moduleId, rowId, safeSeconds, updatedAt);

      if (safePassIndex > 0 && safePassSeconds > 0) {
        await tx.prepare(`
          INSERT INTO response_time_segments (user_id, module_id, row_id, pass_index, seconds, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id, module_id, row_id, pass_index) DO UPDATE SET
            seconds = GREATEST(response_time_segments.seconds, excluded.seconds),
            updated_at = excluded.updated_at
        `).run(userId, moduleId, rowId, safePassIndex, safePassSeconds, updatedAt);
      }
    });
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
    const contentByRowId = new Map(await Promise.all(moduleSnapshot.questions.map(async (question) => [
      question.row_id,
      await getQuestionContent(question)
    ])));
    const submittedAt = now();
    const outcome = await db.transaction(async (tx) => {
      const lockedModule = await requireOwnedModuleQuestion(moduleId, null, tx, { lock: true });
      if (lockedModule.submitted_at) return { alreadySubmitted: true, nextModuleId: null };

      const responseRows = await tx.prepare(`
        SELECT row_id, answer, flagged
        FROM module_responses
        WHERE user_id = ? AND module_id = ?
      `).all(userId, moduleId);
      const responsesById = new Map(responseRows.map((row) => [row.row_id, row]));
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

      if (graded.length) {
        const responseValues = graded.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
        const responseArgs = graded.flatMap(({ question, answer, flagged, grade }) => [
          userId,
          moduleId,
          question.row_id,
          answer,
          flagged,
          grade.status,
          grade.isCorrect,
          submittedAt
        ]);
        await tx.prepare(`
          INSERT INTO module_responses (
            user_id, module_id, row_id, answer, flagged, status, is_correct, updated_at
          ) VALUES ${responseValues}
          ON CONFLICT(user_id, module_id, row_id) DO UPDATE SET
            answer = excluded.answer,
            flagged = excluded.flagged,
            status = excluded.status,
            is_correct = excluded.is_correct,
            updated_at = excluded.updated_at
        `).run(...responseArgs);

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
        await tx.prepare(`
          INSERT INTO progress (user_id, row_id, status, flagged, selected_answer, answered_at, updated_at)
          VALUES ${progressValues}
          ON CONFLICT(user_id, row_id) DO UPDATE SET
            status = excluded.status,
            flagged = excluded.flagged,
            selected_answer = excluded.selected_answer,
            answered_at = excluded.answered_at,
            updated_at = excluded.updated_at
        `).run(...progressArgs);
      }

      await tx.prepare("UPDATE test_modules SET submitted_at = ? WHERE id = ? AND user_id = ?")
        .run(submittedAt, moduleId, userId);
      const nextModule = await tx.prepare(`
        SELECT id
        FROM test_modules
        WHERE user_id = ? AND session_id = ? AND position = ? AND submitted_at IS NULL
        LIMIT 1
      `).get(userId, lockedModule.session_id, Number(lockedModule.position) + 1);

      if (nextModule) {
        await tx.prepare(`
          UPDATE test_modules
          SET started_at = COALESCE(started_at, ?)
          WHERE id = ? AND user_id = ?
        `).run(submittedAt, nextModule.id, userId);
      } else {
        await tx.prepare(`
          UPDATE test_sessions
          SET submitted_at = ?
          WHERE id = ? AND user_id = ?
        `).run(submittedAt, lockedModule.session_id, userId);
      }
      return { alreadySubmitted: false, nextModuleId: nextModule?.id || null };
    });

    const submittedModule = await getModule(moduleId);
    return {
      ...submittedModule,
      next_section_module_id: outcome.alreadySubmitted
        ? submittedModule?.next_section_module_id || null
        : outcome.nextModuleId
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
