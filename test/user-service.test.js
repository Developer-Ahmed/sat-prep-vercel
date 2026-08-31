import test from "node:test";
import assert from "node:assert/strict";
import { createUserService } from "../server/modules/users/service.js";

function fakeDatabase() {
  const receipts = new Map();
  const statements = [];
  const transactionDatabase = {
    prepare(sql) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      return {
        async run(...args) {
          statements.push({ sql: normalized, args });
          if (normalized.startsWith("INSERT INTO clerk_webhook_events")) {
            if (receipts.has(args[0])) return { changes: 0 };
            receipts.set(args[0], { event_type: args[1], payload_sha256: args[2] });
          }
          return { changes: 1 };
        },
        async get(eventId) {
          statements.push({ sql: normalized, args: [eventId] });
          return receipts.get(eventId);
        }
      };
    }
  };
  return {
    statements,
    prepare() {
      throw new Error("Webhook writes must stay inside the transaction.");
    },
    runAsUser(userId, callback) {
      statements.push({ sql: "RUN AS USER", args: [userId] });
      return callback();
    },
    transaction(callback) {
      return callback(transactionDatabase);
    }
  };
}

const receipt = {
  eventId: "msg_12345678",
  eventType: "user.created",
  payloadSha256: "a".repeat(64),
  userId: "user_12345678"
};

test("Clerk user events are applied once in the receipt transaction", async () => {
  const db = fakeDatabase();
  const service = createUserService({ db, currentUserId: () => receipt.userId, practice: {} });
  assert.deepEqual(await service.processClerkWebhook(receipt), { duplicate: false });
  assert.deepEqual(await service.processClerkWebhook(receipt), { duplicate: true });
  assert.equal(db.statements.filter(({ sql }) => sql.startsWith("INSERT INTO app_users")).length, 1);
  assert.equal(db.statements.filter(({ sql }) => sql === "RUN AS USER").length, 2);
});

test("a reused webhook event ID with different content is rejected", async () => {
  const db = fakeDatabase();
  const service = createUserService({ db, currentUserId: () => receipt.userId, practice: {} });
  await service.processClerkWebhook(receipt);
  await assert.rejects(
    service.processClerkWebhook({ ...receipt, payloadSha256: "b".repeat(64) }),
    /reused with different content/
  );
});

test("progress reset is tenant-scoped and returns refreshed status", async () => {
  const db = fakeDatabase();
  const practice = { async getStatus(subject, pool) { return { subject, pool, total: 0 }; } };
  const service = createUserService({ db, currentUserId: () => "user_12345678", practice });
  assert.deepEqual(await service.resetProgress("math", "main"), { subject: "math", pool: "main", total: 0 });
  assert.equal(db.statements.filter(({ sql }) => sql.startsWith("DELETE FROM")).length, 2);
  assert.ok(db.statements.every(({ args }) => !args?.length || !args.includes("user_other")));
});

test("recent user synchronization avoids a database write on every request", async () => {
  let writes = 0;
  const db = {
    prepare() {
      return { async run() { writes += 1; return { changes: 1 }; } };
    }
  };
  const service = createUserService({ db, currentUserId: () => "user_12345678", practice: {} });
  await Promise.all([service.ensureUser(), service.ensureUser()]);
  await service.ensureUser();
  assert.equal(writes, 1);
});
