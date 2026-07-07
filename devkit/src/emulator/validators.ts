import type { AgentValidator } from "../manifest/schema.js";
import type { MemoryStore } from "../memory/store.js";

/** Outcome of evaluating one validator. */
export interface ValidatorResult {
  validator: AgentValidator["type"];
  passed: boolean;
  /** Human-readable explanation — shown in the trace and fed to repair attempts. */
  detail: string;
}

/**
 * Evaluate all manifest validators against a run's output, in order.
 *
 * Matches the platform's three validator types (A.3):
 *  - `shape`     — output must exist and be at least minBytes
 *  - `freshness` — a referenced memory asset must be newer than maxAgeHours
 *  - `invariant` — output must match / must not match a regex
 *
 * All validators are always evaluated (no short-circuit) so the trace shows
 * the complete picture, exactly like the platform's validator report.
 */
export async function evaluateValidators(
  validators: readonly AgentValidator[],
  output: string,
  store: MemoryStore,
  now: Date = new Date(),
): Promise<ValidatorResult[]> {
  const results: ValidatorResult[] = [];
  for (const validator of validators) {
    switch (validator.type) {
      case "shape": {
        const bytes = Buffer.byteLength(output, "utf8");
        const passed = bytes >= validator.minBytes;
        results.push({
          validator: "shape",
          passed,
          detail: passed
            ? `output is ${bytes} bytes (>= ${validator.minBytes})`
            : `output is ${bytes} bytes, expected at least ${validator.minBytes}`,
        });
        break;
      }
      case "freshness": {
        const asset = await store.get(validator.asset);
        if (!asset) {
          results.push({
            validator: "freshness",
            passed: false,
            detail: `memory asset "${validator.asset}" does not exist`,
          });
          break;
        }
        const ageHours = (now.getTime() - new Date(asset.record.updatedAt).getTime()) / 3_600_000;
        const passed = ageHours <= validator.maxAgeHours;
        results.push({
          validator: "freshness",
          passed,
          detail: passed
            ? `asset "${validator.asset}" is ${ageHours.toFixed(2)}h old (<= ${validator.maxAgeHours}h)`
            : `asset "${validator.asset}" is ${ageHours.toFixed(2)}h old, must be newer than ${validator.maxAgeHours}h`,
        });
        break;
      }
      case "invariant": {
        let regex: RegExp;
        try {
          regex = new RegExp(validator.pattern);
        } catch (error) {
          results.push({
            validator: "invariant",
            passed: false,
            detail: `invalid regex "${validator.pattern}": ${(error as Error).message}`,
          });
          break;
        }
        const matched = regex.test(output);
        const passed = validator.mustMatch ? matched : !matched;
        results.push({
          validator: "invariant",
          passed,
          detail: passed
            ? `output ${validator.mustMatch ? "matches" : "does not match"} /${validator.pattern}/ as required`
            : `output ${matched ? "matches" : "does not match"} /${validator.pattern}/ but ${validator.mustMatch ? "must match" : "must NOT match"}`,
        });
        break;
      }
    }
  }
  return results;
}
