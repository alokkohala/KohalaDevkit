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
const TSC = fileURLToPath(import.meta.resolve("typescript/lib/tsc.js"));

let workDir: string;

async function kohala(
  args: string[],
  options: { cwd?: string; env?: Record<string, string> } = {},
) {
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

  it("init --language ts scaffolds, validates, runs, and dry-run deploys", async () => {
    const init = await kohala(["init", "e2e-ts-agent", "--language", "ts"]);
    expect(init.exitCode).toBe(0);

    const agentDir = path.join(workDir, "e2e-ts-agent");
    expect(fs.existsSync(path.join(agentDir, "kohala.json"))).toBe(true);
    expect(fs.existsSync(path.join(agentDir, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(agentDir, "tsconfig.json"))).toBe(true);
    expect(fs.existsSync(path.join(agentDir, "skills", "main.ts"))).toBe(true);
    expect(fs.existsSync(path.join(agentDir, "skills", "_tools.ts"))).toBe(true);

    const manifest = fs.readFileSync(path.join(agentDir, "kohala.json"), "utf8");
    expect(manifest).toContain('"name": "e2e-ts-agent"');
    expect(manifest).toContain('"main": "main.ts"');
    expect(manifest).toContain('"dependencies": []');

    const validate = await kohala(["validate", "e2e-ts-agent"]);
    expect(validate.exitCode).toBe(0);
    expect(validate.stdout).toContain("is valid");

    const typecheck = await execa(
      "node",
      [
        TSC,
        "--project",
        path.join(agentDir, "tsconfig.json"),
        "--typeRoots",
        path.resolve(here, "..", "node_modules", "@types"),
      ],
      {
        reject: false,
      },
    );
    expect(typecheck.exitCode, typecheck.stderr || typecheck.stdout).toBe(0);

    const run = await kohala(["run", "e2e-ts-agent", "--local"]);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain("succeeded");

    const deploy = await kohala(["deploy", "e2e-ts-agent", "--dry-run"]);
    expect(deploy.exitCode).toBe(0);
    expect(deploy.stdout).toContain("main.ts");
    expect(deploy.stdout).toContain('"runtimeLanguage": "node"');
    expect(deploy.stdout).toContain("POST /api/v1/agents");
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

  it("validate preserves LLM-mode prompt-file skills", async () => {
    const example = path.resolve(here, "..", "examples", "llm-notes");
    const result = await kohala(["validate", example]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("is valid");
  });

  it("validate rejects unknown tool ids and honors --allow-unknown-tools", async () => {
    const manifestPath = path.join(workDir, "e2e-agent", "kohala.json");
    const original = fs.readFileSync(manifestPath, "utf8");
    const typo = JSON.parse(original) as Record<string, unknown>;
    typo.toolAllowlist = ["htpp.geet"];
    fs.writeFileSync(manifestPath, JSON.stringify(typo));

    const rejected = await kohala(["validate", "e2e-agent"]);
    expect(rejected.exitCode).toBe(1);
    expect(rejected.stderr).toContain("htpp.geet");
    expect(rejected.stderr).toContain("not in the Kohala tool catalog");

    const allowed = await kohala(["validate", "e2e-agent", "--allow-unknown-tools"]);
    expect(allowed.exitCode).toBe(0);
    expect(allowed.stderr).toContain("htpp.geet");
    expect(allowed.stdout).toContain("is valid");

    fs.writeFileSync(manifestPath, original);
    const real = await kohala(["validate", "e2e-agent"]);
    expect(real.exitCode).toBe(0);
    expect(real.stdout).toContain("is valid");
  });

  it("run --local executes a shift, passes validators, writes memory + trace", async () => {
    const result = await kohala(["run", "e2e-agent", "--local"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("succeeded");
    expect(result.stdout).toContain("never billed");
    expect(fs.existsSync(path.join(workDir, ".kohala", "trace", "e2e-agent.jsonl"))).toBe(true);
    expect(fs.existsSync(path.join(workDir, ".kohala", "memory", "e2e-agent", "index.json"))).toBe(
      true,
    );
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

describe("kohala CLI with a TypeScript agent", () => {
  const agent = "e2e-ts-agent";

  function writeManifest(extra: Record<string, unknown> = {}): void {
    const dir = path.join(workDir, agent);
    fs.mkdirSync(path.join(dir, "skills"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "skills", "main.ts"),
      "export async function run(): Promise<void> {\n  console.log('hello');\n}\n",
    );
    fs.writeFileSync(
      path.join(dir, "kohala.json"),
      JSON.stringify(
        {
          name: agent,
          charter: "Report the weather in TypeScript.",
          toolAllowlist: ["s3.put"],
          runtimeMode: "wrap",
          skills: { main: "main.ts" },
          caps: { perRunTokens: 1000, perDayTokens: 5000 },
          validators: [],
          ...extra,
        },
        null,
        2,
      ),
    );
  }

  it("validate accepts a .ts skill and reports the detected language", async () => {
    writeManifest({ dependencies: ["zod"] });
    const result = await kohala(["validate", agent]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("language=node");
    expect(result.stdout).toContain("skills/main.ts (TypeScript/JavaScript)");
    expect(result.stdout).toContain("npm packages: zod");
  });

  it("validate rejects a package outside the platform allowlist", async () => {
    writeManifest({ dependencies: ["axios"] });
    const result = await kohala(["validate", agent]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('unsupported npm dependencies for framework "custom": axios');
    expect(result.stderr).toContain("Supported packages:");

    const allowed = await kohala(["validate", agent, "--allow-unknown-packages"]);
    expect(allowed.exitCode).toBe(0);
    expect(allowed.stderr).toContain("warning:");
  });

  it("validate rejects a skill file no runtime can execute", async () => {
    writeManifest({ skills: { main: "main.rb" } });
    const result = await kohala(["validate", agent]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(".ts");
  });

  it("deploy --dry-run sends runtimeLanguage and scriptDependencies", async () => {
    writeManifest({ dependencies: ["zod"] });
    const result = await kohala(["deploy", agent, "--dry-run"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('"runtimeLanguage": "node"');
    expect(result.stdout).toContain('"scriptDependencies"');
    expect(result.stdout).toContain("TypeScript/JavaScript");
  });

  it("deploy refuses a non-allowlisted package before contacting the platform", async () => {
    writeManifest({ dependencies: ["axios"] });
    const result = await kohala(["deploy", agent, "--dry-run"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('unsupported npm dependencies for framework "custom": axios');
    expect(result.stdout).not.toContain("POST /api/v1/agents");
  });

  it("run --local executes a TypeScript skill with Node instead of Python", async () => {
    writeManifest();
    const result = await kohala(["run", agent, "--local"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("succeeded");
  });
});
