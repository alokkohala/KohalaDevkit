import fs from "node:fs";
import path from "node:path";
import type { TraceEvent } from "./events.js";

/** Absolute path of an agent's JSONL trace file under the workspace root. */
export function traceFilePath(rootDir: string, agent: string): string {
  return path.join(rootDir, ".kohala", "trace", `${agent}.jsonl`);
}

/**
 * Appends structured events to `.kohala/trace/<agent>.jsonl`.
 *
 * Writes are synchronous appends — one JSON object per line — so a crash
 * mid-run still leaves a readable audit trail up to the crash point,
 * mirroring the platform's append-only run records.
 */
export class TraceWriter {
  private readonly filePath: string;

  constructor(rootDir: string, agent: string) {
    this.filePath = traceFilePath(rootDir, agent);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  /** Append one event as a JSONL line. */
  append(event: TraceEvent): void {
    fs.appendFileSync(this.filePath, `${JSON.stringify(event)}\n`, "utf8");
  }

  /** The file this writer appends to (used by `kohala trace`). */
  get file(): string {
    return this.filePath;
  }
}
