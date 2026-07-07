import fs from "node:fs";
import path from "node:path";

/**
 * Minimal interprocess mutex built on atomic `mkdir`.
 *
 * The usage ledger and the file memory index are read-modify-write JSON
 * files that can be touched by overlapping processes (two `kohala run`s, or
 * `kohala memory serve` next to a run). `mkdir` is atomic on every platform
 * Node supports, so a lock directory gives us a portable mutex without any
 * dependencies.
 *
 * Locks are considered stale (crashed holder) after STALE_MS and are broken
 * loudly rather than waited on forever.
 */

const STALE_MS = 10_000;
const ACQUIRE_TIMEOUT_MS = 5_000;
const RETRY_DELAY_MS = 15;

function sleep(ms: number): void {
  // Synchronous sleep keeps the locked sections synchronous (the callers are
  // sync fs code); Atomics.wait avoids burning CPU in the retry loop.
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, ms);
}

/**
 * Run `fn` while holding an exclusive lock named after `filePath`.
 * Throws if the lock cannot be acquired within ACQUIRE_TIMEOUT_MS.
 */
export function withFileLock<T>(filePath: string, fn: () => T): T {
  const lockDir = `${filePath}.lock`;
  fs.mkdirSync(path.dirname(lockDir), { recursive: true });

  const deadline = Date.now() + ACQUIRE_TIMEOUT_MS;
  for (;;) {
    try {
      fs.mkdirSync(lockDir);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // Break stale locks left behind by a crashed process.
      try {
        const age = Date.now() - fs.statSync(lockDir).mtimeMs;
        if (age > STALE_MS) {
          fs.rmdirSync(lockDir);
          continue;
        }
      } catch {
        // The holder released it between our checks — retry immediately.
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `Timed out waiting for lock ${lockDir} — another kohala process is holding it. ` +
            `If no other process is running, delete the directory and retry.`,
          { cause: error },
        );
      }
      sleep(RETRY_DELAY_MS);
    }
  }

  try {
    return fn();
  } finally {
    try {
      fs.rmdirSync(lockDir);
    } catch {
      // Already removed (stale-broken by another waiter); nothing to do.
    }
  }
}

/** Atomically replace `filePath` with `content` (temp file + rename). */
export function atomicWriteFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, content, "utf8");
  fs.renameSync(tempPath, filePath);
}
