function normalizeArgs(args) {
  if (args.length === 1 && Array.isArray(args[0])) return args[0];
  return args;
}

function localStatement(statement, sourceSQL) {
  return {
    sourceSQL,
    async all(...args) {
      return statement.all(...normalizeArgs(args));
    },
    async get(...args) {
      return statement.get(...normalizeArgs(args));
    },
    async run(...args) {
      return statement.run(...normalizeArgs(args));
    }
  };
}

async function localDatabase(path) {
  const { DatabaseSync } = await import("node:sqlite");
  const connection = new DatabaseSync(path);

  return {
    kind: "local",
    async exec(sql) {
      connection.exec(sql);
    },
    prepare(sql) {
      return localStatement(connection.prepare(sql), sql);
    },
    async transaction(callback) {
      connection.exec("BEGIN IMMEDIATE");
      try {
        const value = await callback(this);
        connection.exec("COMMIT");
        return value;
      } catch (error) {
        connection.exec("ROLLBACK");
        throw error;
      }
    }
  };
}

function remoteStatement(client, sql) {
  const execute = (args) => client.execute({ sql, args: normalizeArgs(args) });

  return {
    sourceSQL: sql,
    async all(...args) {
      const result = await execute(args);
      return Array.from(result.rows);
    },
    async get(...args) {
      const result = await execute(args);
      return result.rows[0];
    },
    async run(...args) {
      const result = await execute(args);
      return {
        changes: result.rowsAffected,
        lastInsertRowid: result.lastInsertRowid == null ? undefined : Number(result.lastInsertRowid)
      };
    }
  };
}

function remoteDatabase(client) {
  return {
    kind: "remote",
    async exec(sql) {
      await client.executeMultiple(sql);
    },
    prepare(sql) {
      return remoteStatement(client, sql);
    },
    async transaction(callback) {
      const transaction = await client.transaction("write");
      const scoped = {
        kind: "remote",
        async exec(sql) {
          await transaction.executeMultiple(sql);
        },
        prepare(sql) {
          return remoteStatement(transaction, sql);
        }
      };

      try {
        const value = await callback(scoped);
        await transaction.commit();
        return value;
      } catch (error) {
        await transaction.rollback();
        throw error;
      } finally {
        transaction.close();
      }
    }
  };
}

export async function openDatabase({ path }) {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (!url) return localDatabase(path);
  if (!authToken) throw new Error("TURSO_AUTH_TOKEN is required when TURSO_DATABASE_URL is set.");

  const { createClient } = await import("@libsql/client");
  return remoteDatabase(createClient({ url, authToken }));
}
