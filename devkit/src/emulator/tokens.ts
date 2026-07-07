import fs from "node:fs";
import path from "node:path";
import type { AgentCaps } from "../manifest/schema.js";
import { atomicWriteFile, withFileLock } from "../util/lock.js";

/**
 * Token accounting without billing.
 *
 * The emulator counts tokens exactly like the platform does for cap
 * enforcement — but it never charges anything. That is the devkit's
 * "no metering" promise: numbers show up in the trace, money never does.
 */

/** Rough token estimate: ~4 characters per token, the platform's heuristic. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Current UTC day as YYYY-MM-DD — per-day caps reset on UTC midnight. */
export function utcDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Shape of the on-disk usage ledger (.kohala/usage/<agent>.json). */
interface UsageFile {
  /** Map of UTC day -> total tokens consumed by local runs that day. */
  days: Record<string, number>;
}

function usageFilePath(rootDir: string, agent: string): string {
  return path.join(rootDir, ".kohala", "usage", `${agent}.json`);
}

/** Read the persisted per-day token totals for an agent. */
export function readUsage(rootDir: string, agent: string): UsageFile {
  const filePath = usageFilePath(rootDir, agent);
  if (!fs.existsSync(filePath)) return { days: {} };
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as UsageFile;
}

/** Persist the per-day token totals for an agent (atomic replace). */
function writeUsage(rootDir: string, agent: string, usage: UsageFile): void {
  atomicWriteFile(usageFilePath(rootDir, agent), JSON.stringify(usage, null, 2));
}

/** Thrown when a cap would be crossed. `code` mirrors the platform's abort codes. */
export class CapExceededError extends Error {
  constructor(
    readonly code: "PER_DAY_TOKEN_CAP" | "PER_RUN_TOKEN_CAP",
    message: string,
  ) {
    super(message);
    this.name = "CapExceededError";
  }
}

/**
 * Tracks token consumption for one shift and enforces both caps.
 *
 * Enforcement order mirrors the platform (A.2):
 *  1. `admitRun()` — admission check against the per-day cap BEFORE any work.
 *  2. `admitLlmTurn(projected)` — before each LLM turn, abort if the projected
 *     total would cross the per-run cap.
 *  3. `add(tokens)` — record actual consumption and persist the day total.
 */
export class TokenMeter {
  /** Tokens consumed by this shift so far. */
  runTotal = 0;
  /** Set when a cap abort happened, so the runner can report the right status. */
  abortedWith: CapExceededError | null = null;

  constructor(
    private readonly rootDir: string,
    private readonly agent: string,
    private readonly caps: AgentCaps,
  ) {}

  /** Tokens already consumed today (UTC), across all local runs. */
  dayTotal(): number {
    const usage = readUsage(this.rootDir, this.agent);
    return usage.days[utcDay()] ?? 0;
  }

  /**
   * Admission: refuse the shift before any work if today's local runs have
   * already exhausted the per-day cap — the platform refuses the same way.
   */
  admitRun(): void {
    const today = this.dayTotal();
    if (today >= this.caps.perDayTokens) {
      const error = new CapExceededError(
        "PER_DAY_TOKEN_CAP",
        `PER_DAY_TOKEN_CAP: today's usage (${today} tokens) has reached the per-day cap of ${this.caps.perDayTokens}. The cap resets at UTC midnight.`,
      );
      this.abortedWith = error;
      throw error;
    }
  }

  /**
   * Pre-turn projection: abort the run if `projectedTokens` more would cross
   * the per-run cap. Called before every LLM turn (wrap-mode llm.complete
   * calls and llm-mode loop turns alike).
   */
  admitLlmTurn(projectedTokens: number): void {
    if (this.runTotal + projectedTokens > this.caps.perRunTokens) {
      const error = new CapExceededError(
        "PER_RUN_TOKEN_CAP",
        `PER_RUN_TOKEN_CAP: this turn is projected to use ~${projectedTokens} tokens, which would push the run total past the per-run cap of ${this.caps.perRunTokens} (used so far: ${this.runTotal}).`,
      );
      this.abortedWith = error;
      throw error;
    }
  }

  /**
   * Record actual consumption and persist it into today's ledger. Returns the
   * new day total. The read-modify-write is guarded by an interprocess lock so
   * overlapping runs can't lose each other's updates (which would undercount
   * usage and let concurrent runs slip past the day cap).
   */
  add(tokens: number): number {
    this.runTotal += tokens;
    return withFileLock(usageFilePath(this.rootDir, this.agent), () => {
      const usage = readUsage(this.rootDir, this.agent);
      const day = utcDay();
      usage.days[day] = (usage.days[day] ?? 0) + tokens;
      writeUsage(this.rootDir, this.agent, usage);
      return usage.days[day] as number;
    });
  }
}
