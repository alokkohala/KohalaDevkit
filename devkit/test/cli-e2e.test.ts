import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * End-to-end CLI tests: run the BUILT bundle (dist/cli/index.js) exactly like
 * an installed `kohala` binary. `npm run build` must have run first — CI
 * builds before testing, and the vitest globalSetup guards locally.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.resolve(here, "..", "dist", "cli", "index.js");

let workDir: string;

async function kohala(args: string[], options: { cwd?: string; env?: Record<string, string> } = {}) {
  return execa("node", [CLI, ...args], {
    cwd: options.cwd ?? workDir,
    env: options.env,
    reject: false,
  });
}

beforeAll(() => {
  if (!fs.existsSync(CLI)) {
    throw new Error(`dist/cli/index.js not found — run "npm run build" before "npm test"`);
  }
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), "kohala-e2e-"));
});

afterAll(() => {
  fs.rmSync(workDir, { recursive: true, force: true });
});

describe("kohala CLI end to end", () => {
  it("--version prints the package version", async () => {
    const result = await kohala(["--version"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("init scaffolds a runnable agent", async () => {
    const result = await kohala(["init", "e2e-agent"]);
    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(path.join(workDir, "e2e-agent", "kohala.json"))).toBe(true);
    expect(fs.existsSync(path.join(workDir, "e2e-agent", "skills", "main.py"))).toBe(true);
    expect(fs.existsSync(path.join(workDir, "e2e-agent", "skills", "_tools.py"))).toBe(true);
    // The scaffold substituted the agent name.
    const manifest = fs.readFileSync(path.join(workDir, "e2e-agent", "kohala.json"), "utf8");
    expect(manifest).toContain('"name": "e2e-agent"');
  });

  it("init refuses to overwrite an existing directory", async () => {
    const result = await kohala(["init", "e2e-agent"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("already exists");
  });

  it("validate accepts the scaffold and rejects a broken manifest", async () => {
    const good = await kohala(["validate", "e2e-agent"]);
    expect(good.exitCode).toBe(0);
    expect(good.stdout).toContain("is valid");

    const manifestPath = path.join(workDir, "e2e-agent", "kohala.json");
    const original = fs.readFileSync(manifestPath, "utf8");
    const broken = JSON.parse(original) as Record<string, unknown>;
    broken.runtimeMode = "banana";
    fs.writeFileSync(manifestPath, JSON.stringify(broken));
    const bad = await kohala(["validate", "e2e-agent"]);
    expect(bad.exitCode).toBe(1);
    expect(bad.stderr).toContain("runtimeMode");
    fs.writeFileSync(manifestPath, original);
  });

  it("run --local executes a shift, passes validators, writes memory + trace", async () => {
    const result = await kohala(["run", "e2e-agent", "--local"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("succeeded");
    expect(result.stdout).toContain("never billed");
    expect(fs.existsSync(path.join(workDir, ".kohala", "trace", "e2e-agent.jsonl"))).toBe(true);
    expect(
      fs.existsSync(path.join(workDir, ".kohala", "memory", "e2e-agent", "index.json")),
    ).toBe(true);
  });

  it("run without --local refuses with guidance", async () => {
    const result = await kohala(["run", "e2e-agent"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--local");
  });

  it("denies tools removed from the allowlist (TOOL_DENIED, failed run)", async () => {
    const manifestPath = path.join(workDir, "e2e-agent", "kohala.json");
    const original = fs.readFileSync(manifestPath, "utf8");
    const manifest = JSON.parse(original) as { toolAllowlist: string[] };
    manifest.toolAllowlist = manifest.toolAllowlist.filter((tool) => tool !== "s3.put");
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));

    const result = await kohala(["run", "e2e-agent", "--local"]);
    fs.writeFileSync(manifestPath, original);
    expect(result.exitCode).toBe(1);

    const traceRaw = fs.readFileSync(
      path.join(workDir, ".kohala", "trace", "e2e-agent.jsonl"),
      "utf8",
    );
    expect(traceRaw).toContain('"allowed":false');
  });

  it("trace prints the audit trail and --json emits raw JSONL", async () => {
    const pretty = await kohala(["trace", "e2e-agent"]);
    expect(pretty.exitCode).toBe(0);
    expect(pretty.stdout).toContain("run_started");

    const json = await kohala(["trace", "e2e-agent", "--json"]);
    const firstLine = json.stdout.split("\n")[0] ?? "";
    expect(() => JSON.parse(firstLine)).not.toThrow();
  });

  it("aborts with PER_DAY_TOKEN_CAP when the day ledger is exhausted", async () => {
    const usagePath = path.join(workDir, ".kohala", "usage", "e2e-agent.json");
    const day = new Date().toISOString().slice(0, 10);
    fs.mkdirSync(path.dirname(usagePath), { recursive: true });
    fs.writeFileSync(usagePath, JSON.stringify({ days: { [day]: 999999999 } }));

    const result = await kohala(["run", "e2e-agent", "--local"]);
    fs.rmSync(usagePath);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("per day token cap");
  });

  it("deploy --dry-run prints the full plan without a network call", async () => {
    const result = await kohala(["deploy", "e2e-agent", "--dry-run"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("POST /api/v1/agents");
    expect(result.stdout).toContain("PUT /api/v1/agents/:id/quota");
    expect(result.stdout).toContain('"perRunTokens": 20000');
  });

  it("deploy without a key fails with login guidance", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "kohala-home-"));
    const result = await kohala(["deploy", "e2e-agent"], {
      env: { HOME: home, KOHALA_API_KEY: "" },
    });
    fs.rmSync(home, { recursive: true, force: true });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("kohala login");
  });

  it("doctor reports the environment", async () => {
    const result = await kohala(["doctor"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("node");
    expect(result.stdout).toContain("python");
  });
});
