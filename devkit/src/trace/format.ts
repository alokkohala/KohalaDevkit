import pc from "picocolors";
import type { TraceEvent } from "./events.js";

/** Short local time (HH:MM:SS) for the human-readable trace view. */
function shortTime(ts: string): string {
  const date = new Date(ts);
  return date.toLocaleTimeString("en-US", { hour12: false });
}

/**
 * Pretty-print one trace event for `kohala trace`.
 *
 * The goal is a scannable audit log: status words are colorized, tool denials
 * and validator failures jump out in red, token accounting stays dim.
 */
export function formatTraceEvent(event: TraceEvent): string {
  const time = pc.dim(shortTime(event.ts));
  switch (event.type) {
    case "run_started":
      return `${time} ${pc.cyan("run_started")} skill=${event.skill} (${event.scriptFilename}) mode=${event.runtimeMode} run=${event.runId}`;
    case "tool_call": {
      const verdict = event.allowed
        ? event.ok
          ? pc.green("ok")
          : pc.red("error")
        : pc.red("DENIED");
      const errorSuffix = event.error ? ` ${pc.red(event.error)}` : "";
      return `${time} ${pc.magenta("tool_call")} ${pc.bold(event.tool)} ${verdict} ${pc.dim(`${event.durationMs}ms`)} ${pc.dim(event.argsSummary)}${errorSuffix}`;
    }
    case "tokens":
      return `${time} ${pc.dim(`tokens +${event.tokens} run=${event.runTotal} day=${event.dayTotal} (${event.source})`)}`;
    case "validator_result": {
      const verdict = event.passed ? pc.green("passed") : pc.red("FAILED");
      return `${time} ${pc.yellow("validator")} ${event.validator} ${verdict} ${pc.dim(event.detail)}`;
    }
    case "repair_attempt":
      return `${time} ${pc.yellow(`repair_attempt ${event.attempt}/${event.maxAttempts}`)} ${pc.dim(event.reason)}`;
    case "run_finished": {
      const color =
        event.status === "succeeded" ? pc.green : event.status === "failed" ? pc.red : pc.red;
      const detailSuffix = event.detail ? ` ${pc.dim(event.detail)}` : "";
      return `${time} ${color(`run_finished ${event.status}`)} tokens=${event.totalTokens} ${pc.dim(`${event.durationMs}ms`)}${detailSuffix}`;
    }
  }
}
