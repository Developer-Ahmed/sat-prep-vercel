import test from "node:test";
import assert from "node:assert/strict";
import { bindPostgresParameters, createDatabase } from "../server/database.js";

test("bindPostgresParameters numbers placeholders without changing quoted question marks", () => {
  assert.equal(
    bindPostgresParameters("SELECT '?' AS literal, value FROM answers WHERE id = ? AND status = ?"),
    "SELECT '?' AS literal, value FROM answers WHERE id = $1 AND status = $2"
  );
});

test("bindPostgresParameters preserves explicit narrow RETURNING clauses", () => {
  assert.equal(
    bindPostgresParameters("INSERT INTO items (id) VALUES (?) RETURNING id"),
    "INSERT INTO items (id) VALUES ($1) RETURNING id"
  );
  assert.equal(bindPostgresParameters("DELETE FROM items WHERE id = ?"), "DELETE FROM items WHERE id = $1");
});

test("transaction executes statements immediately and commits", async () => {
  const events = [];
  const transactionClient = {
    async connect() {
      events.push("connect");
    },
    async query(sql, params = []) {
      events.push([sql, params]);
      if (sql.startsWith("INSERT")) return { rows: [{ id: 42 }], rowCount: 1 };
      if (sql.startsWith("SELECT")) return { rows: [{ id: 42, title: "saved" }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    },
    async end() {
      events.push("end");
    }
  };
  const database = createDatabase({
    queryClient: { query: async () => ({ rows: [] }) },
    transactionClientFactory: () => transactionClient
  });

  const result = await database.transaction(async (tx) => {
    const insert = await tx.prepare("INSERT INTO items (title) VALUES (?) RETURNING id").run("saved");
    assert.equal(insert.lastInsertRowid, 42);
    return tx.prepare("SELECT id, title FROM items WHERE id = ?").get(42);
  });

  assert.deepEqual(result, { id: 42, title: "saved" });
  assert.deepEqual(events, [
    "connect",
    ["BEGIN", []],
    ["INSERT INTO items (title) VALUES ($1) RETURNING id", ["saved"]],
    ["SELECT id, title FROM items WHERE id = $1", [42]],
    ["COMMIT", []],
    "end"
  ]);
});

test("transaction rolls back, closes the client, and preserves the original error", async () => {
  const events = [];
  const expected = new Error("write failed");
  const transactionClient = {
    async connect() {
      events.push("connect");
    },
    async query(sql) {
      events.push(sql);
      if (sql.startsWith("UPDATE")) throw expected;
      return { rows: [], rowCount: 0 };
    },
    async end() {
      events.push("end");
    }
  };
  const database = createDatabase({
    queryClient: { query: async () => ({ rows: [] }) },
    transactionClientFactory: () => transactionClient
  });

  await assert.rejects(
    database.transaction((tx) => tx.prepare("UPDATE items SET title = ? WHERE id = ?").run("broken", 42)),
    (error) => error === expected
  );
  assert.deepEqual(events, ["connect", "BEGIN", "UPDATE items SET title = $1 WHERE id = $2", "ROLLBACK", "end"]);
});

test("transaction closes a client when connection setup fails without issuing rollback", async () => {
  const events = [];
  const expected = new Error("connection failed");
  const database = createDatabase({
    queryClient: { query: async () => ({ rows: [] }) },
    transactionClientFactory: () => ({
      async connect() {
        events.push("connect");
        throw expected;
      },
      async query(sql) {
        events.push(sql);
        return { rows: [], rowCount: 0 };
      },
      async end() {
        events.push("end");
      }
    })
  });

  await assert.rejects(database.transaction(async () => undefined), (error) => error === expected);
  assert.deepEqual(events, ["connect", "end"]);
});

test("tenant-scoped ordinary queries set a transaction-local user context", async () => {
  const events = [];
  const queryClient = {
    query(sql, params = []) {
      return { sql, params };
    },
    async transaction(queries) {
      events.push(queries);
      return [
        { rows: [{ set_config: "user_alpha" }], rowCount: 1 },
        { rows: [{ id: 7 }], rowCount: 1 }
      ];
    }
  };
  const database = createDatabase({
    queryClient,
    transactionClientFactory: () => {
      throw new Error("not used");
    }
  });

  const row = await database.runAsUser("user_alpha", () => database.prepare("SELECT id FROM items WHERE id = ?").get(7));

  assert.deepEqual(row, { id: 7 });
  assert.deepEqual(events, [[
    { sql: "SELECT set_config('app.user_id', $1, true)", params: ["user_alpha"] },
    { sql: "SELECT id FROM items WHERE id = $1", params: [7] }
  ]]);
});

test("tenant-scoped interactive transactions set user context after BEGIN", async () => {
  const events = [];
  const transactionClient = {
    async connect() {
      events.push("connect");
    },
    async query(sql, params = []) {
      events.push([sql, params]);
      return { rows: [], rowCount: 0 };
    },
    async end() {
      events.push("end");
    }
  };
  const database = createDatabase({
    queryClient: { query: async () => ({ rows: [] }) },
    transactionClientFactory: () => transactionClient
  });

  await database.runAsUser("user_beta", () => database.transaction(async () => undefined));

  assert.deepEqual(events, [
    "connect",
    ["BEGIN", []],
    ["SELECT set_config('app.user_id', $1, true)", ["user_beta"]],
    ["COMMIT", []],
    "end"
  ]);
});

test("production role verification accepts a restricted RLS role", async () => {
  const database = createDatabase({
    queryClient: {
      query: async () => ({
        rows: [{
          role_name: "sat_app",
          rolsuper: false,
          rolbypassrls: false,
          table_count: 10,
          owns_tenant_table: false,
          can_assume_table_owner: false,
          can_assume_elevated_role: false,
          can_create_in_schema: false,
          all_rls_enabled: true
        }]
      })
    },
    transactionClientFactory: () => {
      throw new Error("not used");
    }
  });

  assert.equal((await database.verifyRuntimeSecurity({ enforce: true })).safe, true);
});

test("production role verification rejects an owner or RLS-bypass role", async () => {
  const database = createDatabase({
    queryClient: {
      query: async () => ({
        rows: [{
          role_name: "neondb_owner",
          rolsuper: false,
          rolbypassrls: false,
          table_count: 10,
          owns_tenant_table: true,
          can_assume_table_owner: true,
          can_assume_elevated_role: false,
          can_create_in_schema: true,
          all_rls_enabled: true
        }]
      })
    },
    transactionClientFactory: () => {
      throw new Error("not used");
    }
  });

  await assert.rejects(
    database.verifyRuntimeSecurity({ enforce: true }),
    /Unsafe production database role/
  );
});
