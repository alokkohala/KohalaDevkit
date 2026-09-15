/**
 * Runtime languages — which sandbox lane runs a skill script.
 *
 * The hosted platform decides a script's lane from ONE extension table
 * (`ENTRYPOINT_EXTENSIONS` in the platform's shared runtime contract) and the
 * devkit mirrors it here so `kohala validate` reports offline exactly the
 * lane the deploy endpoint will resolve. Keep the two in lockstep: a lane the
 * CLI recognizes but the platform does not is a script that deploys green and
 * never runs.
 *
 * Snapshot date: 2026-09-15.
 */

/** The lanes the platform can execute. */
export const RUNTIME_LANGUAGES = ["python", "node"] as const;
export type RuntimeLanguage = (typeof RUNTIME_LANGUAGES)[number];

/** Entrypoint file extensions each lane accepts. */
export const ENTRYPOINT_EXTENSIONS: Record<RuntimeLanguage, readonly string[]> = {
  python: [".py"],
  node: [".ts", ".mts", ".cts", ".js", ".mjs", ".cjs"],
};

/** Every extension a skill script may carry, derived from the one table above. */
export const SCRIPT_FILE_EXTENSIONS: readonly string[] =
  Object.values(ENTRYPOINT_EXTENSIONS).flat();

/** How each lane is named in CLI output (the platform's own wording). */
export const LANGUAGE_LABEL: Record<RuntimeLanguage, string> = {
  python: "Python",
  node: "TypeScript/JavaScript",
};

/**
 * The lane a skill filename belongs to, or null when the extension is not one
 * the platform can run. Unlike the platform's runtime resolution — which
 * falls back to Python for anything unrecognized, so pre-existing agents keep
 * working — the CLI returns null so a typo'd extension is a loud local error
 * instead of a Python run of a file that is not Python.
 */
export function languageForEntrypointFile(filename: string): RuntimeLanguage | null {
  const lower = (filename || "").toLowerCase();
  for (const language of RUNTIME_LANGUAGES) {
    if (ENTRYPOINT_EXTENSIONS[language].some((ext) => lower.endsWith(ext))) {
      return language;
    }
  }
  return null;
}

/** One skill and the lane its script runs in. */
export interface SkillLanguage {
  name: string;
  scriptFilename: string;
  language: RuntimeLanguage;
}

/**
 * Resolve the lane of every skill in a manifest's `skills` map. Filenames are
 * validated by the manifest schema, so an unrecognized extension cannot reach
 * here; it is treated as Python only as a belt-and-braces fallback (the
 * platform's own default).
 */
export function skillLanguages(skills: Record<string, string>): SkillLanguage[] {
  return Object.entries(skills).map(([name, scriptFilename]) => ({
    name,
    scriptFilename,
    language: languageForEntrypointFile(scriptFilename) ?? "python",
  }));
}

/**
 * A one-word summary of a project's lane for the validate/deploy header:
 * the single lane in use, or "mixed" when the skills span both.
 */
export function summarizeLanguages(skills: Record<string, string>): string {
  const languages = new Set(skillLanguages(skills).map((skill) => skill.language));
  if (languages.size === 0) return "none";
  if (languages.size > 1) return "mixed";
  return [...languages][0] as RuntimeLanguage;
}

/** True when at least one skill in the manifest runs on the Node lane. */
export function hasNodeSkill(skills: Record<string, string>): boolean {
  return skillLanguages(skills).some((skill) => skill.language === "node");
}
