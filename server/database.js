import { Client, neon } from "@neondatabase/serverless";
import { AsyncLocalStorage } from "node:async_hooks";

function normalizeArgs(args) {
  if (args.length === 1 && Array.isArray(args[0])) return args[0];
  return args;
}

// Server-authored SQL uses concise question-mark placeholders; this converts
// them to PostgreSQL's numbered parameters without interpolating values.
function bindPostgresParameters(source) {
  const input = String(source).trim().replace(/;\s*$/, "");
  let output = "";
  let index = 0;
  let quote = "";

  for (let cursor = 0; cursor < input.length; cursor += 1) {
    const character = input[cursor];
    const next = input[cursor + 1];

    if (quote) {
      output += character;
      if (character === quote && next === quote) {
        output += next;
        cursor += 1;
      } else if (character === quote) {
        quote = "";
      }
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      output += character;
    } else if (character === "?") {
      index += 1;
      output += `$${index}`;
    } else {
      output += character;
    }
  }

  return output;
}

function statement(client, sourceSQL) {
  async function execute(args) {
    const params = normalizeArgs(args);
    const query = bindPostgresParameters(sourceSQL);
    return client.query(query, params);
  }

  return {
    sourceSQL,
    async all(...args) {
      const result = await execute(args);
      return Array.from(result.rows || result);
    },
    async get(...args) {
      const result = await execute(args);
      return (result.rows || result)[0];
    },
    async run(...args) {
      const result = await execute(args);
      const rows = result.rows || result || [];
      return {
        changes: Number(result.rowCount ?? rows.length ?? 0),
        lastInsertRowid: rows[0]?.id == null ? undefined : Number(rows[0].id)
      };
    }
  };
}

export function createDatabase({ queryClient, transactionClientFactory }) {
  if (!queryClient?.query) throw new Error("A PostgreSQL query client is required.");
  if (typeof transactionClientFactory !== "function") {
    throw new Error("A PostgreSQL transaction client factory is required.");
  }

  const tenantContext = new AsyncLocalStorage();
  const contextualClient = {
    async query(sql, params = []) {
      const userId = tenantContext.getStore()?.userId;
      if (!userId) return queryClient.query(sql, params);
      if (typeof queryClient.transaction !== "function") {
        throw new Error("The PostgreSQL query client must support transactions for tenant-scoped queries.");
      }
      const results = await queryClient.transaction([
        queryClient.query("SELECT set_config('app.user_id', $1, true)", [userId]),
        queryClient.query(sql, params)
      ]);
      return results[1];
    }
  };

  const database = {
    kind: "postgres",
    runAsUser(userId, callback) {
      const normalized = String(userId || "").trim();
      if (!normalized) throw new Error("A verified user ID is required for tenant-scoped database access.");
      return tenantContext.run({ userId: normalized }, callback);
    },
    prepare(sql) {
      return statement(contextualClient, sql);
    },
    async verifyRuntimeSecurity({ enforce = false } = {}) {
      const result = await queryClient.query(`
        WITH tenant_tables(name) AS (
          VALUES
            ('app_users'), ('progress'), ('test_sessions'), ('test_modules'),
            ('module_questions'), ('module_responses'), ('response_time_segments'),
            ('user_vocab_set_items'), ('vocab_progress'), ('vocab_reviews')
        ), tenant_state AS (
          SELECT
            COUNT(c.oid)::integer AS table_count,
            COALESCE(bool_or(p.tableowner = current_user), false) AS owns_tenant_table,
            COALESCE(bool_or(pg_has_role(current_user, p.tableowner, 'MEMBER')), false) AS can_assume_table_owner,
            COALESCE(bool_and(c.relrowsecurity), false) AS all_rls_enabled
          FROM tenant_tables t
          LEFT JOIN pg_tables p
            ON p.schemaname = current_schema() AND p.tablename = t.name
          LEFT JOIN pg_class c
            ON c.relnamespace = current_schema()::regnamespace
            AND c.relname = t.name
            AND c.relkind IN ('r', 'p')
        )
        SELECT
          current_user AS role_name,
          r.rolsuper,
          r.rolbypassrls,
          tenant_state.table_count,
          tenant_state.owns_tenant_table,
          tenant_state.can_assume_table_owner,
          EXISTS (
            SELECT 1
            FROM pg_roles elevated
            WHERE (elevated.rolsuper OR elevated.rolbypassrls)
              AND pg_has_role(current_user, elevated.oid, 'MEMBER')
          ) AS can_assume_elevated_role,
          has_schema_privilege(current_user, current_schema(), 'CREATE') AS can_create_in_schema,
          tenant_state.all_rls_enabled
        FROM pg_roles r
        CROSS JOIN tenant_state
        WHERE r.rolname = current_user
      `);
      const row = (result.rows || result)[0];
      const safe = row
        && Number(row.table_count) === 10
        && !row.rolsuper
        && !row.rolbypassrls
        && !row.owns_tenant_table
        && !row.can_assume_table_owner
        && !row.can_assume_elevated_role
        && !row.can_create_in_schema
        && row.all_rls_enabled;
      if (enforce && !safe) {
        throw new Error(
          "Unsafe production database role. DATABASE_URL must use the restricted runtime role with RLS enabled; never use the owner connection."
        );
      }
      return { ...row, safe: Boolean(safe) };
    },
    async transaction(callback) {
      const client = transactionClientFactory();
      let transactionStarted = false;
      try {
        await client.connect();
        await client.query("BEGIN");
        transactionStarted = true;
        const userId = tenantContext.getStore()?.userId;
        if (userId) await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
        const scoped = {
          kind: "postgres-transaction",
          prepare(sql) {
            return statement(client, sql);
          }
        };
        const value = await callback(scoped);
        await client.query("COMMIT");
        return value;
      } catch (error) {
        if (transactionStarted) {
          try {
            await client.query("ROLLBACK");
          } catch (rollbackError) {
            if (error && typeof error === "object") error.cause ??= rollbackError;
          }
        }
        throw error;
      } finally {
        await client.end();
      }
    }
  };

  return database;
}

export async function openDatabase() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required. Configure a pooled Neon PostgreSQL connection string.");

  const queryClient = neon(connectionString, { fullResults: true });
  const database = createDatabase({
    queryClient,
    transactionClientFactory: () => new Client({ connectionString })
  });
  const enforceRuntimeRole = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
  await database.verifyRuntimeSecurity({ enforce: enforceRuntimeRole });
  return database;
}

export { bindPostgresParameters };
