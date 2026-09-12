import { HttpError } from "../../platform/http.js";
import { buildVocabularyQuestions } from "./question-builder.js";
import { scheduleVocabularyReview } from "./scheduler.js";

export function createVocabularyService({ db, currentUserId }) {
  function now() {
    return new Date().toISOString();
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
        ? await db.prepare("SELECT * FROM vocab_sets WHERE id = ? AND kind = ? AND active").get(Number(requested), kindKey)
        : await db.prepare("SELECT * FROM vocab_sets WHERE slug = ? AND kind = ? AND active").get(requested, kindKey);
    }
    if (!set) {
      const fallbackSlug = kindKey === "root" ? "roots" : "sat-vocabulary";
      set = await db.prepare("SELECT * FROM vocab_sets WHERE slug = ? AND kind = ? AND active").get(fallbackSlug, kindKey);
    }
    if (!set) throw new HttpError(404, "VOCAB_SET_NOT_FOUND", "Vocabulary set not found.");
    return set;
  }

  async function listVocabSets(kind = "word") {
    const userId = currentUserId();
    const kindKey = normalizeVocabKind(kind);
    return (await db.prepare(`
      SELECT s.*,
        (SELECT COUNT(*) FROM vocab_set_items m WHERE m.set_id = s.id) +
        (SELECT COUNT(*) FROM user_vocab_set_items um WHERE um.user_id = ? AND um.set_id = s.id) AS total
      FROM vocab_sets s
      WHERE s.kind = ? AND s.active
      ORDER BY s.built_in DESC, s.id
    `).all(userId, kindKey)).map((set) => ({ ...set, total: Number(set.total || 0) }));
  }

  async function vocabDashboard(kind = "word", setValue = null) {
    const userId = currentUserId();
    const kindKey = normalizeVocabKind(kind);
    const set = await resolveVocabSet(kindKey, setValue);
    const current = now();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const stats = await db.prepare(`
      WITH memberships AS (
        SELECT set_id, item_id FROM vocab_set_items WHERE set_id = ?
        UNION
        SELECT set_id, item_id FROM user_vocab_set_items WHERE user_id = ? AND set_id = ?
      ), item_stats AS (
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE p.item_id IS NULL OR p.state = 'new') AS new_count,
          COUNT(*) FILTER (WHERE p.state = 'learning') AS learning,
          COUNT(*) FILTER (WHERE p.state = 'mastered') AS mastered,
          COUNT(*) FILTER (WHERE p.item_id IS NOT NULL AND p.due_at <= ?) AS due
        FROM vocab_items i
        JOIN memberships m ON m.item_id = i.id
        LEFT JOIN vocab_progress p ON p.user_id = ? AND p.item_id = i.id
          AND p.set_id = m.set_id
        WHERE i.kind = ? AND i.active AND m.set_id = ?
      ), review_stats AS (
        SELECT
          COUNT(*) AS reviews,
          COUNT(*) FILTER (WHERE correct) AS correct,
          COUNT(*) FILTER (WHERE reviewed_at >= ?) AS reviewed_today
        FROM vocab_reviews
        WHERE user_id = ? AND set_id = ?
      )
      SELECT
        item_stats.*,
        review_stats.reviews,
        review_stats.correct,
        review_stats.reviewed_today
      FROM item_stats
      CROSS JOIN review_stats
    `).get(
      set.id,
      userId,
      set.id,
      current,
      userId,
      kindKey,
      set.id,
      todayStart.toISOString(),
      userId,
      set.id
    );
    const reviews = Number(stats.reviews || 0);
    return {
      kind: kindKey,
      set,
      total: Number(stats.total || 0),
      new: Number(stats.new_count || 0),
      learning: Number(stats.learning || 0),
      mastered: Number(stats.mastered || 0),
      due: Number(stats.due || 0),
      reviewedToday: Number(stats.reviewed_today || 0),
      accuracy: reviews ? Math.round((Number(stats.correct || 0) / reviews) * 100) : 0,
      reviews
    };
  }

  async function vocabSession(kind = "word", requestedLimit = 15, setValue = null) {
    const userId = currentUserId();
    const kindKey = normalizeVocabKind(kind);
    const set = await resolveVocabSet(kindKey, setValue);
    const limit = Math.max(1, Math.min(Number(requestedLimit) || 15, 30));
    const current = now();
    const [items, pool] = await Promise.all([
      db.prepare(`
        WITH memberships AS (
          SELECT set_id, item_id, display_term, display_definition, display_example
          FROM vocab_set_items WHERE set_id = ?
          UNION
          SELECT set_id, item_id, display_term, display_definition, display_example
          FROM user_vocab_set_items WHERE user_id = ? AND set_id = ?
        )
        SELECT i.*, COALESCE(m.display_term, i.term) AS term,
          COALESCE(m.display_definition, i.definition) AS definition,
          COALESCE(m.display_example, i.example) AS example,
          COALESCE(p.state, 'new') AS state, COALESCE(p.interval_days, 0) AS interval_days
        FROM vocab_items i
        JOIN memberships m ON m.item_id = i.id AND m.set_id = ?
        LEFT JOIN vocab_progress p ON p.user_id = ? AND p.item_id = i.id AND p.set_id = m.set_id
        WHERE i.kind = ?
          AND i.active
          AND (p.item_id IS NULL OR p.state = 'new' OR p.due_at <= ?)
        ORDER BY
          CASE WHEN p.item_id IS NOT NULL AND p.state <> 'new' THEN 0 ELSE 1 END,
          COALESCE(p.due_at, '9999-12-31T00:00:00.000Z'),
          RANDOM()
        LIMIT ?
      `).all(set.id, userId, set.id, set.id, userId, kindKey, current, limit),
      db.prepare(`
        WITH memberships AS (
          SELECT set_id, item_id, display_term, display_definition, display_example
          FROM vocab_set_items WHERE set_id = ?
          UNION
          SELECT set_id, item_id, display_term, display_definition, display_example
          FROM user_vocab_set_items WHERE user_id = ? AND set_id = ?
        )
        SELECT i.id,
          COALESCE(m.display_term, i.term) AS term,
          COALESCE(m.display_definition, i.definition) AS definition
        FROM vocab_items i
        JOIN memberships m ON m.item_id = i.id
        WHERE i.kind = ? AND i.active AND m.set_id = ?
      `).all(set.id, userId, set.id, kindKey, set.id)
    ]);

    const questions = buildVocabularyQuestions({ items, pool, kind: kindKey });

    return { kind: kindKey, set, count: questions.length, questions, items };
  }

  async function listVocabItems(kind = "word", search = "", setValue = null) {
    const userId = currentUserId();
    const kindKey = normalizeVocabKind(kind);
    const set = await resolveVocabSet(kindKey, setValue);
    const query = `%${String(search || "").trim()}%`;
    return await db.prepare(`
      WITH memberships AS (
        SELECT set_id, item_id, display_term, display_definition, display_example
        FROM vocab_set_items WHERE set_id = ?
        UNION
        SELECT set_id, item_id, display_term, display_definition, display_example
        FROM user_vocab_set_items WHERE user_id = ? AND set_id = ?
      )
      SELECT i.*, COALESCE(m.display_term, i.term) AS term,
        COALESCE(m.display_definition, i.definition) AS definition,
        COALESCE(m.display_example, i.example) AS example,
        COALESCE(p.state, 'new') AS state, p.due_at, COALESCE(p.interval_days, 0) AS interval_days
      FROM vocab_items i
      JOIN memberships m ON m.item_id = i.id AND m.set_id = ?
      LEFT JOIN vocab_progress p ON p.user_id = ? AND p.item_id = i.id AND p.set_id = m.set_id
      WHERE i.kind = ? AND i.active
        AND (i.term ILIKE ? OR i.definition ILIKE ? OR i.family ILIKE ?)
      ORDER BY lower(i.term)
      LIMIT 400
    `).all(set.id, userId, set.id, set.id, userId, kindKey, query, query, query);
  }

  async function addVocabWord({ term, definition, example = "", setId = null }) {
    const userId = currentUserId();
    const set = await resolveVocabSet("word", setId);
    const cleanTerm = String(term || "").trim();
    const cleanDefinition = String(definition || "").trim();
    const cleanExample = String(example || "").trim();
    if (!cleanTerm || !cleanDefinition) throw new HttpError(400, "INVALID_VOCAB_WORD", "Word and definition are required.");
    if (cleanTerm.length > 100 || cleanDefinition.length > 600 || cleanExample.length > 800) {
      throw new HttpError(400, "INVALID_VOCAB_WORD", "That entry is too long.");
    }
    return db.transaction(async (tx) => {
      await tx.prepare("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))").get(`vocab-membership:${userId}:${set.id}`);
      let item = await tx.prepare(`
        SELECT * FROM vocab_items
        WHERE kind = 'word' AND lower(term) = lower(?)
          AND (owner_user_id IS NULL OR owner_user_id = ?)
        ORDER BY owner_user_id NULLS FIRST
        LIMIT 1
      `).get(cleanTerm, userId);
      if (!item) {
        await tx.prepare(`
          INSERT INTO vocab_items (owner_user_id, kind, term, definition, example, family, source, active, created_at)
          VALUES (?, 'word', ?, ?, ?, '', 'user-added', true, ?)
          ON CONFLICT DO NOTHING
        `).run(userId, cleanTerm, cleanDefinition, cleanExample, now());
        item = await tx.prepare(`
          SELECT * FROM vocab_items
          WHERE owner_user_id = ? AND kind = 'word' AND lower(term) = lower(?)
        `).get(userId, cleanTerm);
      }
      if (!item) throw new Error("The vocabulary word could not be created.");

      const membership = await tx.prepare(`
        SELECT 1 FROM vocab_set_items WHERE set_id = ? AND item_id = ?
        UNION ALL
        SELECT 1 FROM user_vocab_set_items WHERE user_id = ? AND set_id = ? AND item_id = ?
        LIMIT 1
      `).get(set.id, item.id, userId, set.id, item.id);
      if (membership) throw new HttpError(409, "VOCAB_WORD_EXISTS", `That word is already in ${set.name}.`);
      const position = (await tx.prepare(`
        SELECT COALESCE(MAX(position), -1) + 1 AS value
        FROM (
          SELECT position FROM vocab_set_items WHERE set_id = ?
          UNION ALL
          SELECT position FROM user_vocab_set_items WHERE user_id = ? AND set_id = ?
        ) memberships
      `).get(set.id, userId, set.id)).value;
      await tx.prepare(`
        INSERT INTO user_vocab_set_items (
          user_id, set_id, item_id, position, added_at, display_term, display_definition, display_example
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(userId, set.id, item.id, position, now(), cleanTerm, cleanDefinition, cleanExample);
      return item;
    });
  }

  async function reviewVocabItem(itemId, rating, setValue = null, requestId = "") {
    const userId = currentUserId();
    const safeRating = ["again", "hard", "good", "easy"].includes(rating) ? rating : "good";
    const safeRequestId = String(requestId || "").trim();
    if (!/^[a-zA-Z0-9_-]{8,128}$/.test(safeRequestId)) {
      const error = new Error("A valid review request ID is required.");
      error.statusCode = 400;
      error.code = "INVALID_REVIEW_REQUEST";
      throw error;
    }
    const requestedSet = String(setValue || "").trim();
    const requestedIsId = /^\d+$/.test(requestedSet);
    const requestedPredicate = requestedSet
      ? requestedIsId ? "s.id = ?" : "s.slug = ?"
      : "false";
    const requestedArgument = requestedSet ? (requestedIsId ? Number(requestedSet) : requestedSet) : null;
    const targetArguments = [Number(itemId), userId, userId];
    if (requestedSet) targetArguments.push(requestedArgument, requestedArgument);
    const target = await db.prepare(`
      WITH selected_item AS (
        SELECT id, kind
        FROM vocab_items
        WHERE id = ? AND active AND (owner_user_id IS NULL OR owner_user_id = ?)
      )
      SELECT
        i.id AS item_id,
        i.kind,
        s.id AS set_id,
        EXISTS (
          SELECT 1 FROM vocab_set_items m WHERE m.set_id = s.id AND m.item_id = i.id
          UNION ALL
          SELECT 1 FROM user_vocab_set_items um
          WHERE um.user_id = ? AND um.set_id = s.id AND um.item_id = i.id
        ) AS is_member
      FROM selected_item i
      JOIN LATERAL (
        SELECT s.id
        FROM vocab_sets s
        WHERE s.kind = i.kind
          AND s.active
          AND (
            ${requestedPredicate}
            OR s.slug = CASE WHEN i.kind = 'root' THEN 'roots' ELSE 'sat-vocabulary' END
          )
        ORDER BY CASE WHEN ${requestedPredicate} THEN 0 ELSE 1 END
        LIMIT 1
      ) s ON true
    `).get(...targetArguments);
    if (!target || !target.is_member) {
      throw new HttpError(404, "VOCAB_ITEM_NOT_FOUND", "That item is not in the selected vocabulary set.");
    }
    const reviewedAt = now();
    const result = await db.transaction(async (tx) => {
      const reviewState = await tx.prepare(`
        WITH review_write AS (
          INSERT INTO vocab_reviews (user_id, request_id, set_id, item_id, rating, correct, reviewed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id, request_id) DO NOTHING
          RETURNING set_id, item_id, rating
        ), progress_write AS (
          INSERT INTO vocab_progress (
            user_id, set_id, item_id, state, due_at, interval_days, streak, lapses, last_reviewed_at
          ) VALUES (?, ?, ?, 'new', ?, 0, 0, 0, NULL)
          ON CONFLICT(user_id, set_id, item_id) DO UPDATE SET state = vocab_progress.state
          RETURNING state, interval_days, due_at
        )
        SELECT
          EXISTS (SELECT 1 FROM review_write) AS inserted,
          COALESCE(
            (SELECT set_id FROM review_write),
            (SELECT set_id FROM vocab_reviews WHERE user_id = ? AND request_id = ?)
          ) AS existing_set_id,
          COALESCE(
            (SELECT item_id FROM review_write),
            (SELECT item_id FROM vocab_reviews WHERE user_id = ? AND request_id = ?)
          ) AS existing_item_id,
          COALESCE(
            (SELECT rating FROM review_write),
            (SELECT rating FROM vocab_reviews WHERE user_id = ? AND request_id = ?)
          ) AS existing_rating,
          (SELECT state FROM progress_write) AS state,
          (SELECT interval_days FROM progress_write) AS interval_days,
          (SELECT due_at FROM progress_write) AS due_at
      `).get(
        userId,
        safeRequestId,
        target.set_id,
        target.item_id,
        safeRating,
        safeRating !== "again",
        reviewedAt,
        userId,
        target.set_id,
        target.item_id,
        reviewedAt,
        userId,
        safeRequestId,
        userId,
        safeRequestId,
        userId,
        safeRequestId
      );

      if (!reviewState.inserted) {
        if (
          Number(reviewState.existing_set_id) !== Number(target.set_id)
          || Number(reviewState.existing_item_id) !== Number(target.item_id)
          || reviewState.existing_rating !== safeRating
        ) {
          const error = new Error("That review request ID was already used for a different review.");
          error.statusCode = 409;
          error.code = "IDEMPOTENCY_CONFLICT";
          throw error;
        }
        return {
          state: reviewState.state || "new",
          intervalDays: Number(reviewState.interval_days || 0),
          dueAt: reviewState.due_at || reviewedAt
        };
      }
      const schedule = scheduleVocabularyReview({
        previousIntervalDays: reviewState.interval_days,
        rating: safeRating,
        reviewedAt: new Date(reviewedAt)
      });

      await tx.prepare(`
        UPDATE vocab_progress
        SET state = ?, due_at = ?, interval_days = ?,
            streak = CASE WHEN ? = 'again' THEN 0 ELSE streak + 1 END,
            lapses = lapses + CASE WHEN ? = 'again' THEN 1 ELSE 0 END,
            last_reviewed_at = ?
        WHERE user_id = ? AND set_id = ? AND item_id = ?
      `).run(
        schedule.state,
        schedule.dueAt,
        schedule.intervalDays,
        safeRating,
        safeRating,
        reviewedAt,
        userId,
        target.set_id,
        target.item_id
      );
      return schedule;
    });
    return {
      itemId: target.item_id,
      rating: safeRating,
      ...result
    };
  }

  return {
    addVocabWord,
    listVocabItems,
    listVocabSets,
    reviewVocabItem,
    vocabDashboard,
    vocabSession
  };
}
