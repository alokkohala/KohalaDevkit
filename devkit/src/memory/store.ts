/**
 * The MemoryStore interface — the platform's memory surface, locally.
 *
 * Both the emulator (via the SDK RPC) and the MCP memory server sit on top of
 * this interface, so an agent sees identical memory semantics whether it is
 * talking to `kohala run --local`, `kohala memory serve`, or the hosted
 * platform:
 *
 * - `s3.put(key, body, category?)` — store under a logical key
 * - `s3.get(keyOrId)`              — resolve by logical key first
 * - `s3.list(prefix?, limit?)`     — list active assets for the agent
 * - `s3.delete(keyOrId)`           — remove + deactivate
 */

/** Index entry for one stored asset — mirrors how the platform tracks assets. */
export interface MemoryRecord {
  /** Stable unique id (UUID). `get`/`delete` accept this as a fallback to the key. */
  id: string;
  /** Logical key the agent chose, e.g. "weather/latest". */
  key: string;
  /** Asset category. Run results default to "agentoutput" on the platform. */
  category: string;
  /** Body size in bytes. */
  size: number;
  /** ISO-8601 creation time. */
  createdAt: string;
  /** ISO-8601 last-update time. */
  updatedAt: string;
  /** Deleted assets are deactivated, not erased from the index. */
  active: boolean;
}

/** Default category for run results, matching the platform. */
export const DEFAULT_CATEGORY = "agentoutput";

/** Default `list` page size. */
export const DEFAULT_LIST_LIMIT = 100;

/** A record plus its body, as returned by `get`. */
export interface MemoryAsset {
  record: MemoryRecord;
  body: Buffer;
}

/**
 * Storage backend contract. Implementations: FileMemoryStore (default) and
 * PostgresMemoryStore (optional, requires `pg`).
 */
export interface MemoryStore {
  /**
   * Store `body` under `key`. If an active record already exists for the key,
   * it is updated in place (same id, new body/category/updatedAt) — logical
   * keys are unique among active assets.
   */
  put(key: string, body: Buffer, category?: string): Promise<MemoryRecord>;

  /**
   * Fetch an asset. Resolution order matches the platform: active logical key
   * first, then record id. Returns null when nothing matches.
   */
  get(keyOrId: string): Promise<MemoryAsset | null>;

  /** List active assets, optionally filtered by key prefix, newest first. */
  list(prefix?: string, limit?: number): Promise<MemoryRecord[]>;

  /**
   * Remove + deactivate an asset: the body is deleted, the index entry stays
   * with `active: false` (mirroring the platform's soft-delete). Returns the
   * deactivated record, or null if nothing matched.
   */
  delete(keyOrId: string): Promise<MemoryRecord | null>;

  /** Release any underlying resources (DB connections, file handles). */
  close(): Promise<void>;
}
