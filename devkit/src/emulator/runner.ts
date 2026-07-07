import crypto from "node:crypto";
import path from "node:path";
import { execa, ExecaError } from "execa";
import type { AgentManifest } from "../manifest/schema.js";
import type { MemoryStore } from "../memory/store.js";
import { TraceWriter } from "../trace/writer.js";
import type { RunStatus } from "../trace/events.js";
import { CapExceededError, TokenMeter } from "./tokens.js";
import { evaluateValidators, type ValidatorResult } from "./validators.js";
import { startSdkRpcServer } from "../sdk/rpc.js";
import { runLlmShift } from "./llm-mode.js";
import { findPython } from "./python.js";

/**
 * The shift runner — executes one agent shift with the platform's exact
 * enforcement order (A.2):
 *
 *   1. Admission (per-day token cap, refused BEFORE any work)
 *   2. Tool allowlist (enforced on every tool call via the dispatcher)
 *   3. Per-run cap (projected before each LLM turn)
 *   4. Validators, with a bounded repair loop (max 2 attempts, platform default)
 *
 * Tokens are counted for cap enforcement and shown in the trace, but nothing
 * is ever charged — that is the "no metering" promise.
 */

/** Platform default: at most 2 repair attempts after a validator failure. */
export const MAX_REPAIR_ATTEMPTS = 2;

/** Inputs for one shift. */
export interface RunShiftOptions {
  /** Workspace root (where .kohala/ lives). */
  rootDir: string;
  /** The agent's directory (contains kohala.json and skills/). */
  agentDir: string;
  manifest: AgentManifest;
  store: MemoryStore;
  /** Skill to run; defaults to the only skill when there is exactly one. */
  skill?: string;
}

/** Outcome of one shift. */
export interface ShiftResult {
  runId: string;
  status: RunStatus;
  /** The run output (script stdout in wrap mode; final text in llm mode). */
  output: string;
  totalTokens: number;
  validatorResults: ValidatorResult[];
  /** Human-readable failure/abort detail, if any. */
  detail?: string;
}

/** Resolve which skill a shift should execute, failing loudly on ambiguity. */
export function resolveSkill(manifest: AgentManifest, requested?: string): [string, string] {
  const entries = Object.entries(manifest.skills);
  if (entries.length === 0) {
    throw new Error(`Agent "${manifest.name}" has no skills in kohala.json`);
  }
  if (requested) {
    const script = manifest.skills[requested];
    if (!script) {
      throw new Error(
        `Skill "${requested}" not found. Available skills: ${entries.map(([name]) => name).join(", ")}`,
      );
    }
    return [requested, script];
  }
  if (entries.length === 1) {
    return entries[0] as [string, string];
  }
  throw new Error(
    `Agent "${manifest.name}" has ${entries.length} skills — pick one with --skill <name> ` +
      `(${entries.map(([name]) => name).join(", ")})`,
  );
}

/** Run one shift end-to-end. Never throws for run-level failures — the result carries the status. */
export async function runShift(options: RunShiftOptions): Promise<ShiftResult> {
  const { rootDir, agentDir, manifest, store } = options;
  const runId = `run_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
  const trace = new TraceWriter(rootDir, manifest.name);
  const meter = new TokenMeter(rootDir, manifest.name, manifest.caps);
  const startedAt = Date.now();
  const [skillName, scriptFilename] = resolveSkill(manifest, options.skill);

  const finish = (
    status: RunStatus,
    output: string,
    validatorResults: ValidatorResult[],
    detail?: string,
  ): ShiftResult => {
    trace.append({
      ts: new Date().toISOString(),
      runId,
      agent: manifest.name,
      type: "run_finished",
      status,
      totalTokens: meter.runTotal,
      durationMs: Date.now() - startedAt,
      ...(detail ? { detail } : {}),
    });
    return { runId, status, output, totalTokens: meter.runTotal, validatorResults, detail };
  };

  // 1. Admission: refuse the shift before any work if the per-day cap is spent.
  try {
    meter.admitRun();
  } catch (error) {
    if (error instanceof CapExceededError) {
      return finish("aborted_per_day_token_cap", "", [], error.message);
    }
    throw error;
  }

  trace.append({
    ts: new Date().toISOString(),
    runId,
    agent: manifest.name,
    type: "run_started",
    runtimeMode: manifest.runtimeMode,
    skill: skillName,
    scriptFilename,
  });

  const context = { manifest, store, trace, meter, runId };

  // llm mode: a real tool-use loop against the developer's own key, with the
  // same bounded validator repair loop as wrap mode (A.2 step 4).
  if (manifest.runtimeMode === "llm") {
    try {
      let repairReason = "";
      for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt += 1) {
        if (attempt > 0) {
          trace.append({
            ts: new Date().toISOString(),
            runId,
            agent: manifest.name,
            type: "repair_attempt",
            attempt,
            maxAttempts: MAX_REPAIR_ATTEMPTS,
            reason: repairReason,
          });
        }
        const output = await runLlmShift(
          context,
          skillName,
          path.join(agentDir, "skills", scriptFilename),
          attempt > 0 ? repairReason : undefined,
        );
        const validatorResults = await evaluateValidators(manifest.validators, output, store);
        recordValidatorResults(trace, runId, manifest.name, validatorResults);
        const failures = validatorResults.filter((result) => !result.passed);
        if (failures.length === 0) {
          return finish("succeeded", output, validatorResults);
        }
        repairReason = failures
          .map((failure) => `${failure.validator}: ${failure.detail}`)
          .join("; ");
        if (attempt === MAX_REPAIR_ATTEMPTS) {
          return finish(
            "failed",
            output,
            validatorResults,
            `validators failed after ${MAX_REPAIR_ATTEMPTS} repair attempts: ${repairReason}`,
          );
        }
      }
      throw new Error("repair loop exited without a result");
    } catch (error) {
      if (error instanceof CapExceededError || meter.abortedWith) {
        const cap = (error instanceof CapExceededError ? error : meter.abortedWith) as CapExceededError;
        const status: RunStatus =
          cap.code === "PER_RUN_TOKEN_CAP" ? "aborted_per_run_token_cap" : "aborted_per_day_token_cap";
        return finish(status, "", [], cap.message);
      }
      return finish("error", "", [], (error as Error).message);
    }
  }

  // wrap mode: execute the skill script directly and validate its output.
  const rpc = await startSdkRpcServer(context);
  try {
    let repairReason = "";
    for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt += 1) {
      if (attempt > 0) {
        trace.append({
          ts: new Date().toISOString(),
          runId,
          agent: manifest.name,
          type: "repair_attempt",
          attempt,
          maxAttempts: MAX_REPAIR_ATTEMPTS,
          reason: repairReason,
        });
      }

      const execution = await executeScript({
        agentDir,
        scriptFilename,
        rpcUrl: rpc.url,
        manifest,
        runId,
        repairAttempt: attempt,
        repairFeedback: repairReason,
      });

      if (!execution.ok) {
        // A cap abort inside the script (llm.complete denied) surfaces here.
        if (meter.abortedWith?.code === "PER_RUN_TOKEN_CAP") {
          return finish("aborted_per_run_token_cap", execution.stdout, [], meter.abortedWith.message);
        }
        return finish("error", execution.stdout, [], execution.errorDetail);
      }

      const validatorResults = await evaluateValidators(
        manifest.validators,
        execution.stdout,
        store,
      );
      recordValidatorResults(trace, runId, manifest.name, validatorResults);

      const failures = validatorResults.filter((result) => !result.passed);
      if (failures.length === 0) {
        return finish("succeeded", execution.stdout, validatorResults);
      }
      repairReason = failures.map((failure) => `${failure.validator}: ${failure.detail}`).join("; ");
      if (attempt === MAX_REPAIR_ATTEMPTS) {
        return finish("failed", execution.stdout, validatorResults, `validators failed after ${MAX_REPAIR_ATTEMPTS} repair attempts: ${repairReason}`);
      }
    }
    // Unreachable: the loop always returns.
    throw new Error("repair loop exited without a result");
  } finally {
    await rpc.close();
  }
}

function recordValidatorResults(
  trace: TraceWriter,
  runId: string,
  agent: string,
  results: ValidatorResult[],
): void {
  for (const result of results) {
    trace.append({
      ts: new Date().toISOString(),
      runId,
      agent,
      type: "validator_result",
      validator: result.validator,
      passed: result.passed,
      detail: result.detail,
    });
  }
}

interface ExecuteScriptOptions {
  agentDir: string;
  scriptFilename: string;
  rpcUrl: string;
  manifest: AgentManifest;
  runId: string;
  repairAttempt: number;
  repairFeedback: string;
}

interface ScriptExecution {
  ok: boolean;
  stdout: string;
  errorDetail?: string;
}

/**
 * Execute a skill script with the SDK environment. The script's stdout is the
 * run output that validators evaluate — stderr is passed through for
 * debugging and never treated as output.
 */
async function executeScript(options: ExecuteScriptOptions): Promise<ScriptExecution> {
  const python = await findPython();
  const scriptPath = path.join(options.agentDir, "skills", options.scriptFilename);
  try {
    const result = await execa(python, [scriptPath], {
      cwd: options.agentDir,
      env: {
        KOHALA_RPC_URL: options.rpcUrl,
        KOHALA_AGENT: options.manifest.name,
        KOHALA_RUN_ID: options.runId,
        KOHALA_REPAIR_ATTEMPT: String(options.repairAttempt),
        KOHALA_VALIDATOR_FEEDBACK: options.repairFeedback,
      },
      // Surface the script's stderr live so developers see their own logging.
      stderr: "inherit",
      reject: false,
      timeout: 10 * 60 * 1000,
    });
    if (result.exitCode !== 0) {
      return {
        ok: false,
        stdout: result.stdout ?? "",
        errorDetail: `script ${options.scriptFilename} exited with code ${result.exitCode}`,
      };
    }
    return { ok: true, stdout: result.stdout ?? "" };
  } catch (error) {
    const message = error instanceof ExecaError ? error.message : (error as Error).message;
    return { ok: false, stdout: "", errorDetail: message };
  }
}
