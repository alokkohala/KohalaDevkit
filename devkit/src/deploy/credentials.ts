import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Credential storage for `kohala login` / `kohala deploy`.
 *
 * Precedence: the KOHALA_API_KEY environment variable always wins; otherwise
 * the key saved by `kohala login` in ~/.kohala/credentials.json is used.
 * The file is written with mode 600 (owner read/write only).
 */

/** Path of the credentials file (~/.kohala/credentials.json). */
export function credentialsPath(): string {
  return path.join(os.homedir(), ".kohala", "credentials.json");
}

interface CredentialsFile {
  apiKey: string;
}

/** Persist a pk_ API key with restrictive permissions. */
export function saveApiKey(apiKey: string): string {
  if (!apiKey.startsWith("pk_")) {
    throw new Error('Kohala API keys start with "pk_". Check the key and try again.');
  }
  const filePath = credentialsPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const payload: CredentialsFile = { apiKey };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
  return filePath;
}

/**
 * Resolve the API key: env var first, then the saved credentials file.
 * Returns null when neither is configured.
 */
export function resolveApiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.KOHALA_API_KEY) return env.KOHALA_API_KEY;
  const filePath = credentialsPath();
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as CredentialsFile;
    return parsed.apiKey ?? null;
  } catch {
    throw new Error(
      `${filePath} is corrupted — delete it and run "kohala login" again.`,
    );
  }
}
