import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_CATEGORY,
  DEFAULT_LIST_LIMIT,
  type MemoryAsset,
  type MemoryRecord,
  type MemoryStore,
} from "./store.js";
import { atomicWriteFile, withFileLock } from "../util/lock.js";

/** Shape of the on-disk JSON index file. */
interface IndexFile {
  records: MemoryRecord[];
}

/** Directory holding one agent's file-backed memory. */
export function memoryDirFor(rootDir: string, agent: string): string {
  return path.join(rootDir, ".kohala", "memory", agent);
}

/**
 * File-backed memory store — the default backend.
 *
 * Layout (per agent, mirroring the platform's per-agent asset tracking):
 *
 *   .kohala/memory/<agent>/index.json   — the asset index (key, category,
 *                                         timestamps, active flag)
 *   .kohala/memory/<agent>/bodies/<id>  — raw body bytes, one file per asset
 *
 * The index is small and rewritten atomically on every mutation (write to a
 * temp file, then rename) so a crash can't leave a half-written index.
 */
export class FileMemoryStore implements MemoryStore {
  private readonly dir: string;
  private readonly indexPath: string;
  private readonly bodiesDir: string;

  constructor(rootDir: string, agent: string) {
    this.dir = memoryDirFor(rootDir, agent);
    this.indexPath = path.join(this.dir, "index.json");
    this.bodiesDir = path.join(this.dir, "bodies");
    fs.mkdirSync(this.bodiesDir, { recursive: true });
  }

  private readIndex(): IndexFile {
    if (!fs.existsSync(this.indexPath)) {
      return { records: [] };
    }
    const raw = fs.readFileSync(this.indexPath, "utf8");
    return JSON.parse(raw) as IndexFile;
  }

  private writeIndex(index: IndexFile): void {
    atomicWriteFile(this.indexPath, JSON.stringify(index, null, 2));
  }

  private bodyPath(id: string): string {
    return path.join(this.bodiesDir, id);
  }

  async put(key: string, body: Buffer, category: string = DEFAULT_CATEGORY): Promise<MemoryRecord> {
    // The index read-modify-write is guarded by an interprocess lock so a
    // concurrent run or MCP server can't clobber this update.
    return withFileLock(this.indexPath, () => {
      const index = this.readIndex();
      const now = new Date().toISOString();
      const existing = index.records.find((record) => record.active && record.key === key);

      if (existing) {
        // Logical keys are unique among active assets: overwrite in place.
        existing.category = category;
        existing.size = body.byteLength;
        existing.updatedAt = now;
        fs.writeFileSync(this.bodyPath(existing.id), body);
        this.writeIndex(index);
        return { ...existing };
      }

      const record: MemoryRecord = {
        id: crypto.randomUUID(),
        key,
        category,
        size: body.byteLength,
        createdAt: now,
        updatedAt: now,
        active: true,
      };
      fs.writeFileSync(this.bodyPath(record.id), body);
      index.records.push(record);
      this.writeIndex(index);
      return { ...record };
    });
  }

  async get(keyOrId: string): Promise<MemoryAsset | null> {
    const index = this.readIndex();
    // Platform resolution order: active logical key first, then record id.
    const record =
      index.records.find((entry) => entry.active && entry.key === keyOrId) ??
      index.records.find((entry) => entry.active && entry.id === keyOrId);
    if (!record) return null;
    const filePath = this.bodyPath(record.id);
    if (!fs.existsSync(filePath)) {
      throw new Error(
        `Memory index lists ${record.key} (${record.id}) but its body file is missing at ${filePath}`,
      );
    }
    return { record: { ...record }, body: fs.readFileSync(filePath) };
  }

  async list(prefix?: string, limit: number = DEFAULT_LIST_LIMIT): Promise<MemoryRecord[]> {
    const index = this.readIndex();
    return index.records
      .filter((record) => record.active && (prefix === undefined || record.key.startsWith(prefix)))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
      .slice(0, limit)
      .map((record) => ({ ...record }));
  }

  async delete(keyOrId: string): Promise<MemoryRecord | null> {
    return withFileLock(this.indexPath, () => {
      const index = this.readIndex();
      const record =
        index.records.find((entry) => entry.active && entry.key === keyOrId) ??
        index.records.find((entry) => entry.active && entry.id === keyOrId);
      if (!record) return null;
      // Remove the body, deactivate the index entry (soft delete, like the platform).
      record.active = false;
      record.updatedAt = new Date().toISOString();
      const filePath = this.bodyPath(record.id);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      this.writeIndex(index);
      return { ...record };
    });
  }

  async close(): Promise<void> {
    // Nothing to release for the file backend.
  }
}
