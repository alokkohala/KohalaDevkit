import crypto from "node:crypto";
import {
  DEFAULT_CATEGORY,
  DEFAULT_LIST_LIMIT,
  type MemoryAsset,
  type MemoryRecord,
  type MemoryStore,
} from "./store.js";

/** Minimal structural type for the parts of `pg.Pool` we use. */
interface PgPoolLike {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
}

/** One row of the kohala_memory table, as returned by pg. */
interface MemoryRow {
  id: string;
  key: string;
  category: string;
  body: Buffer | null;
  size: string | number;
  created_at: Date;
  updated_at: Date;
  active: boolean;
}

function rowToRecord(row: MemoryRow): MemoryRecord {
  return {
    id: row.id,
    key: row.key,
    category: row.category,
    size: Number(row.size),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    active: row.active,
  };
}

/**
 * Postgres-backed memory store.
 *
 * Design decision (documented per the build plan): the index AND the bodies
 * live in one table — bodies are stored as `bytea` in the same row. This
 * keeps the backend to a single table with no filesystem coupling, so any
 * plain Postgres URL works (no volume required).
 *
 * The table is created on first connect (idempotent migration). `pg` is an
 * optional peer dependency and is imported lazily so file-backend users never
 * need it installed.
 */
export class PostgresMemoryStore implements MemoryStore {
  private constructor(
    private readonly pool: PgPoolLike,
    private readonly agent: string,
  ) {}

  /** Connect, run the idempotent migration, and return a ready store. */
  static async connect(url: string, agent: string): Promise<PostgresMemoryStore> {
    let pgModule: typeof import("pg");
    try {
      pgModule = await import("pg");
    } catch {
      throw new Error(
        'The postgres backend requires the optional "pg" package. Install it with: npm install pg',
      );
    }
    const PoolCtor = pgModule.default?.Pool ?? pgModule.Pool;
    const pool = new PoolCtor({ connectionString: url }) as unknown as PgPoolLike;

    // Idempotent migration on first connect — a single table holds the index
    // semantics from A.1 (key, category, timestamps, active flag) plus bodies.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS kohala_memory (
        id UUID PRIMARY KEY,
        agent TEXT NOT NULL,
        key TEXT NOT NULL,
        category TEXT NOT NULL,
        body BYTEA,
        size BIGINT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        active BOOLEAN NOT NULL DEFAULT TRUE
      )
    `);
    await pool.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS kohala_memory_active_key
      ON kohala_memory (agent, key) WHERE active
    `);

    return new PostgresMemoryStore(pool, agent);
  }

  async put(key: string, body: Buffer, category: string = DEFAULT_CATEGORY): Promise<MemoryRecord> {
    const now = new Date();
    const existing = await this.pool.query(
      "SELECT * FROM kohala_memory WHERE agent = $1 AND key = $2 AND active",
      [this.agent, key],
    );
    if (existing.rows.length > 0) {
      const row = existing.rows[0] as unknown as MemoryRow;
      const updated = await this.pool.query(
        `UPDATE kohala_memory SET category = $1, body = $2, size = $3, updated_at = $4
         WHERE id = $5 RETURNING *`,
        [category, body, body.byteLength, now, row.id],
      );
      return rowToRecord(updated.rows[0] as unknown as MemoryRow);
    }
    const inserted = await this.pool.query(
      `INSERT INTO kohala_memory (id, agent, key, category, body, size, created_at, updated_at, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7, TRUE) RETURNING *`,
      [crypto.randomUUID(), this.agent, key, category, body, body.byteLength, now],
    );
    return rowToRecord(inserted.rows[0] as unknown as MemoryRow);
  }

  async get(keyOrId: string): Promise<MemoryAsset | null> {
    // Platform resolution order: active logical key first, then record id.
    const byKey = await this.pool.query(
      "SELECT * FROM kohala_memory WHERE agent = $1 AND key = $2 AND active",
      [this.agent, keyOrId],
    );
    let row = byKey.rows[0] as unknown as MemoryRow | undefined;
    if (!row && isUuid(keyOrId)) {
      const byId = await this.pool.query(
        "SELECT * FROM kohala_memory WHERE agent = $1 AND id = $2 AND active",
        [this.agent, keyOrId],
      );
      row = byId.rows[0] as unknown as MemoryRow | undefined;
    }
    if (!row) return null;
    return { record: rowToRecord(row), body: row.body ?? Buffer.alloc(0) };
  }

  async list(prefix?: string, limit: number = DEFAULT_LIST_LIMIT): Promise<MemoryRecord[]> {
    const result = prefix
      ? await this.pool.query(
          `SELECT id, agent, key, category, NULL AS body, size, created_at, updated_at, active
           FROM kohala_memory WHERE agent = $1 AND active AND key LIKE $2 || '%'
           ORDER BY updated_at DESC LIMIT $3`,
          [this.agent, prefix, limit],
        )
      : await this.pool.query(
          `SELECT id, agent, key, category, NULL AS body, size, created_at, updated_at, active
           FROM kohala_memory WHERE agent = $1 AND active
           ORDER BY updated_at DESC LIMIT $2`,
          [this.agent, limit],
        );
    return result.rows.map((row) => rowToRecord(row as unknown as MemoryRow));
  }

  async delete(keyOrId: string): Promise<MemoryRecord | null> {
    const asset = await this.get(keyOrId);
    if (!asset) return null;
    // Remove the body, deactivate the row (soft delete, like the platform).
    const updated = await this.pool.query(
      `UPDATE kohala_memory SET active = FALSE, body = NULL, updated_at = $1
       WHERE id = $2 RETURNING *`,
      [new Date(), asset.record.id],
    );
    return rowToRecord(updated.rows[0] as unknown as MemoryRow);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

/** Loose UUID check so non-UUID keys never hit the uuid-typed id column. */
function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
