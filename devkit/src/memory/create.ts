import { FileMemoryStore } from "./file.js";
import { PostgresMemoryStore } from "./postgres.js";
import type { MemoryStore } from "./store.js";

/** Supported backend names for `kohala memory serve --backend <name>`. */
export type MemoryBackend = "file" | "postgres";

/** Options for creating a memory store for one agent. */
export interface CreateMemoryStoreOptions {
  backend: MemoryBackend;
  /** Agent name — memory is always scoped per agent, like on the platform. */
  agent: string;
  /** Workspace root for the file backend (defaults to process.cwd()). */
  rootDir?: string;
  /** Postgres connection string (required for the postgres backend). */
  url?: string;
}

/**
 * Create a MemoryStore for the requested backend.
 *
 * Fails loudly when the postgres backend is requested without a URL — there
 * is no silent fallback to the file backend.
 */
export async function createMemoryStore(options: CreateMemoryStoreOptions): Promise<MemoryStore> {
  if (options.backend === "file") {
    return new FileMemoryStore(options.rootDir ?? process.cwd(), options.agent);
  }
  if (!options.url) {
    throw new Error(
      "The postgres backend needs a connection string. Pass --url or set DATABASE_URL.",
    );
  }
  return PostgresMemoryStore.connect(options.url, options.agent);
}
