import fs from "node:fs";
import path from "node:path";
import type { ZodError, ZodIssue } from "zod";
import { manifestSchema, type AgentManifest } from "./schema.js";

/** Error thrown when a kohala.json cannot be read, parsed, or validated. */
export class ManifestError extends Error {
  /** One human-readable problem per line, each with a fix hint when we have one. */
  readonly problems: string[];

  constructor(message: string, problems: string[] = []) {
    super(message);
    this.name = "ManifestError";
    this.problems = problems;
  }
}

/**
 * Fix hints keyed by the top-level manifest field an issue occurred under.
 * These show up next to validation errors so a broken manifest is
 * self-explanatory without opening the docs.
 */
const FIELD_HINTS: Record<string, string> = {
  name: 'use a short identifier like "my-agent" (letters, digits, "-", "_")',
  charter: "write the agent's mission as a non-empty string",
  toolAllowlist: 'list allowed tool names, e.g. ["s3.put", "http.post_json"]',
  runtimeMode: 'must be "wrap" (script wrapper) or "llm" (tool-use loop)',
  skills: 'map skill name to script filename, e.g. {"collect": "main.py"}',
  schedule: 'use a cron expression like "0 9 * * *" (only used on deploy)',
  caps: "set caps.perRunTokens and caps.perDayTokens as positive integers",
  validators: 'each validator needs a "type" of "shape", "freshness" or "invariant"',
};

/** Turn one Zod issue into a "path: message (hint: ...)" line. */
function formatIssue(issue: ZodIssue): string {
  const issuePath = issue.path.length > 0 ? issue.path.join(".") : "(root)";
  const topLevelField = String(issue.path[0] ?? "");
  const hint = FIELD_HINTS[topLevelField];
  const hintSuffix = hint ? ` (hint: ${hint})` : "";
  return `${issuePath}: ${issue.message}${hintSuffix}`;
}

/** Format a full ZodError into per-issue problem lines. */
export function formatManifestIssues(error: ZodError): string[] {
  return error.issues.map(formatIssue);
}

/** Absolute path of the kohala.json inside an agent directory. */
export function manifestPath(agentDir: string): string {
  return path.join(agentDir, "kohala.json");
}

/**
 * Load and validate the kohala.json inside `agentDir`.
 *
 * Fails loudly with a ManifestError that lists every problem plus a fix hint —
 * never returns a partially-valid manifest.
 */
export function loadManifest(agentDir: string): AgentManifest {
  const filePath = manifestPath(agentDir);
  if (!fs.existsSync(filePath)) {
    throw new ManifestError(
      `No kohala.json found at ${filePath}`,
      [`create one with: kohala init ${path.basename(agentDir) || "<name>"}`],
    );
  }

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    throw new ManifestError(`Could not read ${filePath}: ${(error as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ManifestError(`${filePath} is not valid JSON: ${(error as Error).message}`, [
      "check for trailing commas or missing quotes",
    ]);
  }

  const result = manifestSchema.safeParse(parsed);
  if (!result.success) {
    throw new ManifestError(`${filePath} failed validation`, formatManifestIssues(result.error));
  }
  return result.data;
}
