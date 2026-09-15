/**
 * Snapshot of the npm packages the hosted platform will install for a
 * TypeScript/JavaScript agent script, used by `kohala validate` and
 * `kohala deploy` to refuse an unsupported package OFFLINE — before the
 * deploy request is sent.
 *
 * The platform enforces this list authoritatively at attach time (the
 * acceptance gate rejects the script before storing it), so a package that
 * fails here would fail there; checking locally only moves the same refusal
 * earlier, with the same words. Pass `--allow-unknown-packages` when the
 * bundled snapshot is stale — the deploy endpoint still has the last word.
 *
 * A CLI-deployed script is a `custom` agent, whose framework bundle is empty,
 * so the accepted set is exactly the platform's common Node allowlist.
 * Snapshot date: 2026-09-15.
 */

/** The framework a CLI-deployed script is attached as, on the platform. */
export const CLI_FRAMEWORK = "custom";

/**
 * The platform's common npm allowlist. HTTP clients (`axios`, `node-fetch`,
 * `undici`, …) are deliberately absent platform-side: they bypass the global
 * `fetch` the hosted runtime intercepts for egress metering.
 */
export const ALLOWED_NPM_PACKAGES: readonly string[] = [
  "zod",
  "openai",
  "@anthropic-ai/sdk",
  "ai",
  "@ai-sdk/openai",
  "@ai-sdk/anthropic",
  "date-fns",
  "cheerio",
  "js-yaml",
];

/**
 * Normalize an npm package name for comparison. npm names are
 * case-insensitive-ish but NOT punctuation-insensitive (unlike pip), so
 * `-`, `_` and `.` are preserved — `@ai-sdk/openai` and `@ai_sdk/openai` are
 * different packages.
 */
export function normalizeNpmName(name: string): string {
  return name.trim().toLowerCase();
}

/** The declared packages that are not on the snapshot allowlist. */
export function rejectedNpmPackages(dependencies: readonly string[]): string[] {
  const allowed = new Set(ALLOWED_NPM_PACKAGES.map(normalizeNpmName));
  const seen = new Set<string>();
  const rejected: string[] = [];
  for (const dependency of dependencies) {
    const normalized = normalizeNpmName(dependency);
    if (!normalized || allowed.has(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    rejected.push(dependency.trim());
  }
  return rejected;
}

/**
 * The platform's own rejection sentence for unsupported packages, reproduced
 * verbatim so the CLI and the server say the same thing about the same
 * packages.
 */
export function npmAllowlistMessage(rejected: readonly string[]): string {
  return (
    `unsupported npm dependencies for framework "${CLI_FRAMEWORK}": ${rejected.join(", ")}. ` +
    `Supported packages: ${ALLOWED_NPM_PACKAGES.map(normalizeNpmName).sort().join(", ")}`
  );
}
