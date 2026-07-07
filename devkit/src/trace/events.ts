/**
 * Trace event types — the local twin of the platform's run/audit records.
 *
 * Every run appends structured JSONL events to `.kohala/trace/<agent>.jsonl`.
 * Each line is one event; every event carries the run id and a timestamp so
 * the file can be tailed, filtered, and replayed.
 */

/** Fields shared by every trace event. */
export interface TraceEventBase {
  /** ISO-8601 timestamp of when the event was written. */
  ts: string;
  /** Unique id for the shift this event belongs to. */
  runId: string;
  /** The agent's manifest name. */
  agent: string;
}

/** A shift was admitted and started. */
export interface RunStartedEvent extends TraceEventBase {
  type: "run_started";
  runtimeMode: "wrap" | "llm";
  skill: string;
  scriptFilename: string;
}

/** One tool call made by the script or the LLM loop. */
export interface ToolCallEvent extends TraceEventBase {
  type: "tool_call";
  tool: string;
  /** Short, non-sensitive summary of the arguments (truncated). */
  argsSummary: string;
  /** Whether the allowlist permitted the call. */
  allowed: boolean;
  /** Whether the call itself succeeded (always false when denied). */
  ok: boolean;
  durationMs: number;
  error?: string;
}

/** Token accounting for cap enforcement — never billed locally. */
export interface TokensEvent extends TraceEventBase {
  type: "tokens";
  /** Tokens consumed by this increment (e.g. one LLM turn). */
  tokens: number;
  /** Running total for this shift. */
  runTotal: number;
  /** Cumulative total for the current UTC day, including this shift. */
  dayTotal: number;
  source: string;
}

/** Result of evaluating one validator after output was produced. */
export interface ValidatorResultEvent extends TraceEventBase {
  type: "validator_result";
  validator: "shape" | "freshness" | "invariant";
  passed: boolean;
  detail: string;
}

/** One bounded repair attempt after validators failed (max 2, platform default). */
export interface RepairAttemptEvent extends TraceEventBase {
  type: "repair_attempt";
  attempt: number;
  maxAttempts: number;
  reason: string;
}

/** Terminal statuses a shift can end with. */
export type RunStatus =
  | "succeeded"
  | "failed"
  | "aborted_per_day_token_cap"
  | "aborted_per_run_token_cap"
  | "error";

/** The shift finished (successfully or not) with final totals. */
export interface RunFinishedEvent extends TraceEventBase {
  type: "run_finished";
  status: RunStatus;
  totalTokens: number;
  durationMs: number;
  detail?: string;
}

/** Union of every event that may appear in a trace file. */
export type TraceEvent =
  | RunStartedEvent
  | ToolCallEvent
  | TokensEvent
  | ValidatorResultEvent
  | RepairAttemptEvent
  | RunFinishedEvent;
