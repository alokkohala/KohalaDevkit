import { z } from "zod";

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
    /** Map of skill name -> script filename, e.g. {"collect": "main.py"}. */
    skills: z.record(z.string().min(1), z.string().min(1)).default({}),
    /** Cron expression. Used only on deploy; local runs are always manual. */
    schedule: z.string().min(1).optional(),
    caps: capsSchema,
    validators: z.array(validatorSchema).default([]),
  })
  .strict();

/** A parsed, validated kohala.json. */
export type AgentManifest = z.infer<typeof manifestSchema>;
/** A single validator entry. */
export type AgentValidator = z.infer<typeof validatorSchema>;
/** Token caps block. */
export type AgentCaps = z.infer<typeof capsSchema>;
