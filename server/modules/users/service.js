import { parseInput } from "../../platform/http.js";
import { webhookReceiptSchema } from "./contracts.js";

export function createUserService({ db, currentUserId, practice }) {
  const recentUsers = new Map();
  const pendingUsers = new Map();
  const seenTtlMs = 10 * 60 * 1000;

  function rememberUser(userId, timestamp = Date.now()) {
    recentUsers.set(userId, timestamp);
    if (recentUsers.size <= 10_000) return;
    for (const [id, seenAt] of recentUsers) {
      if (timestamp - seenAt >= seenTtlMs) recentUsers.delete(id);
    }
    if (recentUsers.size > 10_000) recentUsers.delete(recentUsers.keys().next().value);
  }

  async function ensureUser(userId = currentUserId(), database = db) {
    const timestamp = Date.now();
    if (database === db && timestamp - Number(recentUsers.get(userId) || 0) < seenTtlMs) return;
    if (database === db && pendingUsers.has(userId)) return pendingUsers.get(userId);

    const seenAt = new Date().toISOString();
    const operation = database.prepare(`
        INSERT INTO app_users (id, created_at, last_seen_at)
        VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET last_seen_at = excluded.last_seen_at
        WHERE app_users.last_seen_at < excluded.last_seen_at - interval '15 minutes'
      `).run(userId, seenAt, seenAt)
      .then(() => {
        if (database === db) rememberUser(userId, timestamp);
      });
    if (database !== db) return operation;
    pendingUsers.set(userId, operation);
    try {
      await operation;
    } finally {
      pendingUsers.delete(userId);
    }
  }

  async function resetProgress(subject, pool) {
    const userId = currentUserId();
    await db.transaction(async (tx) => {
      await tx.prepare(`
        DELETE FROM test_sessions
        WHERE user_id = ? AND subject = ? AND pool = ?
      `).run(userId, subject, pool);
      await tx.prepare(`
        DELETE FROM progress
        WHERE user_id = ? AND row_id IN (
          SELECT row_id FROM question_catalog WHERE subject = ? AND pool = ?
        )
      `).run(userId, subject, pool);
    });
    return practice.getStatus(subject, pool);
  }

  async function processClerkWebhook(input) {
    const receipt = parseInput(webhookReceiptSchema, input);
    const run = async () => db.transaction(async (tx) => {
      const inserted = await tx.prepare(`
        INSERT INTO clerk_webhook_events (event_id, event_type, payload_sha256)
        VALUES (?, ?, ?)
        ON CONFLICT (event_id) DO NOTHING
      `).run(receipt.eventId, receipt.eventType, receipt.payloadSha256);
      if (!inserted.changes) {
        const existing = await tx.prepare(`
          SELECT event_type, payload_sha256 FROM clerk_webhook_events WHERE event_id = ?
        `).get(receipt.eventId);
        if (existing?.event_type !== receipt.eventType || existing?.payload_sha256 !== receipt.payloadSha256) {
          throw new Error("Webhook event ID was reused with different content.");
        }
        return { duplicate: true };
      }

      if (receipt.eventType === "user.created" || receipt.eventType === "user.updated") {
        if (receipt.userId) await ensureUser(receipt.userId, tx);
      } else if (receipt.eventType === "user.deleted" && receipt.userId) {
        await tx.prepare("DELETE FROM app_users WHERE id = ?").run(receipt.userId);
        recentUsers.delete(receipt.userId);
      }

      await tx.prepare(`
        UPDATE clerk_webhook_events SET processed_at = now() WHERE event_id = ?
      `).run(receipt.eventId);
      await tx.prepare(`
        DELETE FROM clerk_webhook_events WHERE received_at < now() - interval '90 days'
      `).run();
      return { duplicate: false };
    });

    return receipt.userId ? db.runAsUser(receipt.userId, run) : run();
  }

  return { ensureUser, processClerkWebhook, resetProgress };
}
