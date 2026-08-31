import { createHash } from "node:crypto";
import { Client } from "@neondatabase/serverless";
import { ROOT_SEED, VOCAB_SEED } from "../server/vocab-data.js";
import { VOCAB_TERMS_SEED } from "../server/vocab-terms-data.js";
import { WORDS_ONLY_SEED } from "../server/words-only-data.js";

const databaseUrl = process.env.DATABASE_ADMIN_URL;
if (!databaseUrl) throw new Error("DATABASE_ADMIN_URL is required to seed shared reference data.");

const sets = [
  {
    slug: "sat-vocabulary",
    name: "SAT Vocabulary",
    description: "Your original vocabulary collection",
    kind: "word",
    entries: VOCAB_SEED.map(([term, definition, example = ""]) => ({ term, definition, example }))
  },
  {
    slug: "vocab-terms",
    name: "Vocab Terms",
    description: "Imported from vocab_terms.txt",
    kind: "word",
    entries: VOCAB_TERMS_SEED.map(([term, definition, example = ""]) => ({ term, definition, example }))
  },
  {
    slug: "words-only",
    name: "Words Only",
    description: "Imported from words_only.txt",
    kind: "word",
    entries: WORDS_ONLY_SEED.map(([term, definition, example = ""]) => ({ term, definition, example }))
  },
  {
    slug: "roots",
    name: "Roots",
    description: "High-utility Greek and Latin roots",
    kind: "root",
    entries: ROOT_SEED.map(([term, definition, family = "", origin = ""]) => ({
      term,
      definition,
      example: `Word family: ${family}`,
      family,
      source: origin || "reference-root"
    }))
  }
];

const checksum = createHash("sha256").update(JSON.stringify(sets)).digest("hex");
const client = new Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock($1)", [729482]);
  for (const set of sets) {
    const setResult = await client.query(`
      INSERT INTO vocab_sets (slug, name, description, kind, built_in, active, created_at)
      VALUES ($1, $2, $3, $4, true, true, now())
      ON CONFLICT(slug) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        kind = excluded.kind,
        built_in = true,
        active = true
      RETURNING id
    `, [set.slug, set.name, set.description, set.kind]);
    const setId = setResult.rows[0].id;
    await client.query("DELETE FROM vocab_set_items WHERE set_id = $1", [setId]);

    for (const [position, entry] of set.entries.entries()) {
      const itemResult = await client.query(`
        INSERT INTO vocab_items (
          owner_user_id, kind, term, definition, example, family, source, active, created_at
        ) VALUES (NULL, $1, $2, $3, $4, $5, $6, true, now())
        ON CONFLICT (kind, lower(term)) WHERE owner_user_id IS NULL DO UPDATE SET
          definition = excluded.definition,
          example = excluded.example,
          family = excluded.family,
          source = excluded.source,
          active = true
        RETURNING id
      `, [
        set.kind,
        entry.term,
        entry.definition,
        entry.example || "",
        entry.family || "",
        entry.source || `reference-${set.slug}`
      ]);
      await client.query(`
        INSERT INTO vocab_set_items (
          set_id, item_id, position, added_at, display_term, display_definition, display_example
        )
        VALUES ($1, $2, $3, now(), $4, $5, $6)
        ON CONFLICT(set_id, item_id) DO UPDATE SET
          position = excluded.position,
          display_term = excluded.display_term,
          display_definition = excluded.display_definition,
          display_example = excluded.display_example
      `, [setId, itemResult.rows[0].id, position, entry.term, entry.definition, entry.example || ""]);
    }
  }

  await client.query(`
    INSERT INTO app_settings (key, value)
    VALUES ('referenceData:vocab:checksum', $1)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `, [checksum]);
  await client.query("COMMIT");
  console.log(`Vocabulary reference data is current (${checksum.slice(0, 12)}).`);
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
