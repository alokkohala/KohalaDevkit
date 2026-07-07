import { execa } from "execa";

/**
 * Python is an optional runtime dependency at use time (running skills),
 * never an install-time dependency. We look for `python3` first, then
 * `python`, and fail with an actionable message if neither exists.
 */
let cachedPython: string | null = null;

/** Locate a working Python 3 interpreter or throw with install guidance. */
export async function findPython(): Promise<string> {
  if (cachedPython) return cachedPython;
  for (const candidate of ["python3", "python"]) {
    try {
      const result = await execa(candidate, ["--version"], { reject: false });
      if (result.exitCode === 0 && /Python 3/.test(`${result.stdout}${result.stderr}`)) {
        cachedPython = candidate;
        return candidate;
      }
    } catch {
      // Candidate not on PATH — try the next one.
    }
  }
  throw new Error(
    "Python 3 is required to run agent skills but was not found on your PATH. " +
      "Install it from https://www.python.org/downloads/ (or via your package manager: " +
      "`brew install python3`, `apt install python3`), then re-run this command.",
  );
}

/** Test-only: reset the cached interpreter path. */
export function resetPythonCache(): void {
  cachedPython = null;
}
