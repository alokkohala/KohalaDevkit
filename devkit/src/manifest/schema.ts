import { z } from "zod";
import {
  ENTRYPOINT_EXTENSIONS,
  hasNodeSkill,
  languageForEntrypointFile,
  SCRIPT_FILE_EXTENSIONS,
} from "./language.js";

/**
 * Zod schema for `kohala.json` — the agent manifest.
 *
 * This is the devkit's half of the compatibility contract with the hosted
 * Kohala platform. Every field here maps 1:1 onto a platform field:
 *
 * | Manifest field       | Platform field           |
 * | -------------------- | ------------------------ |
 * | `name`               | agent name (deploy is idempotent on name) |
 * | `charter`            | `agentCharter`           |
 * | `toolAllowlist`      | `agentToolAllowlist`     |
 * | `runtimeMode`        | `agentRuntimeMode`       |
 * | `skills`             | `agentSkills`            |
 * | `dependencies`       | `scriptDependencies` (per Node skill) |
 * | `schedule`           | `agentScheduleCron`      |
 * | `caps.perRunTokens`  | `agentPerRunTokenCap`    |
 * | `caps.perDayTokens`  | `agentPerDayTokenCap`    |
 * | `caps.billingTokens` | `agentBillingCapTokens`  |
 * | `caps.billingPeriod` | `agentBillingCapPeriod`  |
 * | `validators`         | agent validators         |
 *
 * Do not rename fields here without a matching platform change — the whole
 * point of the devkit is that a local agent round-trips losslessly.
 */

/** Billing periods accepted by the platform for `agentBillingCapPeriod`. */
export const BILLING_PERIODS = ["day", "week", "month"] as const;

/**
 * `shape` validator — the run output must exist and be at least `minBytes`
 * bytes long. This is the platform's cheapest sanity check: "did the agent
 * actually produce something?"
 */
export const shapeValidatorSchema = z
  .object({
    type: z.literal("shape"),
    minBytes: z.number().int().nonnegative(),
  })
  .strict();

/**
 * `freshness` validator — a referenced memory asset (by logical key) must be
 * newer than `maxAgeHours`. The platform uses this to catch agents that
 * "succeed" without actually refreshing their data.
 */
export const freshnessValidatorSchema = z
  .object({
    type: z.literal("freshness"),
    /** Logical memory key of the asset that must be fresh. */
    asset: z.string().min(1),
    maxAgeHours: z.number().positive(),
  })
  .strict();

/**
 * `invariant` validator — the run output must match (or must NOT match) a
 * regular expression. `mustMatch: false` inverts the check.
 */
export const invariantValidatorSchema = z
  .object({
    type: z.literal("invariant"),
    /** JavaScript-flavored regular expression source (no delimiters). */
    pattern: z.string().min(1),
    /** When false, the output must NOT match the pattern. Defaults to true. */
    mustMatch: z.boolean().default(true),
  })
  .strict();

/** All validator types supported by the platform, with identical names. */
export const validatorSchema = z.discriminatedUnion("type", [
  shapeValidatorSchema,
  freshnessValidatorSchema,
  invariantValidatorSchema,
]);

/**
 * Token caps. The local emulator enforces these exactly like the hosted
 * platform (see emulator/), but never bills anything — token counts are for
 * cap enforcement and trace visibility only.
 */
export const capsSchema = z
  .object({
    /** Hard token ceiling for a single shift (platform: agentPerRunTokenCap). */
    perRunTokens: z.number().int().positive(),
    /** Cumulative token ceiling per UTC day (platform: agentPerDayTokenCap). */
    perDayTokens: z.number().int().positive(),
    /** Billing-period token cap (platform: agentBillingCapTokens). Ignored locally. */
    billingTokens: z.number().int().positive().optional(),
    /** Billing period for billingTokens (platform: agentBillingCapPeriod). */
    billingPeriod: z.enum(BILLING_PERIODS).optional(),
  })
  .strict()
  .refine((caps) => caps.billingTokens === undefined || caps.billingPeriod !== undefined, {
    message: "caps.billingPeriod is required when caps.billingTokens is set",
    path: ["billingPeriod"],
  });

/** Agent names double as deploy identity and directory names — keep them tame. */
const nameSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[a-z0-9][a-z0-9_-]*$/i,
    "must start with a letter or digit and contain only letters, digits, '-' and '_'",
  );

/**
 * A skill's script filename. The extension picks the lane the platform runs
 * it in (`.py` → Python, `.ts`/`.js` → TypeScript/JavaScript), so an
 * extension neither lane knows is refused here rather than deployed as a
 * skill the platform stores but never executes.
 */
const skillScriptSchema = z.string().min(1);

/**
 * npm package names. The platform caps a script's declared packages at 50
 * names of at most 214 characters (npm's own limit); the same bounds are
 * enforced locally so an over-long list fails before the deploy request.
 */
const dependenciesSchema = z.array(z.string().min(1).max(214)).max(50).default([]);

/** Full manifest schema for kohala.json. */
export const manifestSchema = z
  .object({
    name: nameSchema,
    /** The agent's mission text (platform: agentCharter). */
    charter: z.string().min(1),
    /**
     * Tools the agent may call, e.g. ["s3.put", "http.post_json"].
     * Everything not on this list is denied loudly at runtime.
     */
    toolAllowlist: z.array(z.string().min(1)).default([]),
    /**
     * "wrap"  — execute the skill script directly and validate its output.
     * "llm"   — run a real tool-use loop against the developer's own LLM key.
     */
    runtimeMode: z.enum(["wrap", "llm"]),
    /**
     * Map of skill name -> script filename in `skills/`, e.g.
     * {"collect": "main.py"} or {"collect": "main.ts"}. The file extension
     * decides which runtime the platform executes the script in.
     */
    skills: z.record(z.string().min(1), skillScriptSchema).default({}),
    /**
     * npm packages the TypeScript/JavaScript skills import beyond Node's
     * standard library. Only packages on the platform's allowlist are
     * installed — `kohala validate` and `kohala deploy` refuse anything else
     * offline, before the deploy request. Python skills never use this: pip
     * packages are not installable from the CLI deploy path.
     */
    dependencies: dependenciesSchema,
    /** Cron expression. Used only on deploy; local runs are always manual. */
    schedule: z.string().min(1).optional(),
    caps: capsSchema,
    validators: z.array(validatorSchema).default([]),
  })
  .strict();

/** A parsed, validated kohala.json. */
export type AgentManifest = z.infer<typeof manifestSchema>;

/**
 * Cross-field problems the field-level schema cannot express, reported with
 * the same "one problem per line" shape as a Zod issue.
 *
 * Kept OUT of the schema (as a `.refine`) on purpose: `manifestSchema` must
 * stay a plain object schema so callers can reach into `.shape` (e.g.
 * `kohala init` validating a name before scaffolding anything).
 */
export function crossFieldProblems(manifest: AgentManifest): string[] {
  const problems: string[] = [];
  if (manifest.runtimeMode === "wrap") {
    for (const [name, filename] of Object.entries(manifest.skills)) {
      if (languageForEntrypointFile(filename) === null) {
        problems.push(
          `skills.${name}: "${filename}" must be a script the platform can run in wrap mode — ` +
            `one of: ${SCRIPT_FILE_EXTENSIONS.join(", ")}`,
        );
      }
    }
  }
  if (manifest.dependencies.length > 0 && !hasNodeSkill(manifest.skills)) {
    problems.push(
      `dependencies: declares npm package(s) (${manifest.dependencies.join(", ")}) but no skill is a ` +
        `TypeScript/JavaScript entrypoint — only those install npm packages ` +
        `(hint: use a ${ENTRYPOINT_EXTENSIONS.node.join(" / ")} skill script, or remove "dependencies")`,
    );
  }
  return problems;
}
/** A single validator entry. */
export type AgentValidator = z.infer<typeof validatorSchema>;
/** Token caps block. */
export type AgentCaps = z.infer<typeof capsSchema>;
