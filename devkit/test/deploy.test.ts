import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import {
  buildDeployPlan,
  classifyManualRun409,
  DeployError,
  KohalaClient,
  readableApiError,
  skillPayloadLanguage,
} from "../src/deploy/client.js";
import { manifestSchema } from "../src/manifest/schema.js";

describe("buildDeployPlan", () => {
  let agentDir: string;

  beforeEach(() => {
    agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "kohala-deploy-"));
    fs.mkdirSync(path.join(agentDir, "skills"));
    fs.writeFileSync(path.join(agentDir, "skills", "main.py"), "print('hi')\n");
  });
  afterEach(() => {
    fs.rmSync(agentDir, { recursive: true, force: true });
  });

  it("maps the manifest onto platform payloads", () => {
    const manifest = manifestSchema.parse({
      name: "deployer",
      charter: "Do things.",
      toolAllowlist: ["s3.put"],
      runtimeMode: "wrap",
      skills: { main: "main.py" },
      schedule: "0 9 * * *",
      caps: { perRunTokens: 10, perDayTokens: 20, billingTokens: 100, billingPeriod: "month" },
    });
    const plan = buildDeployPlan(manifest, agentDir);
    expect(plan.agent).toEqual({
      name: "deployer",
      charter: "Do things.",
      toolAllowlist: ["s3.put"],
      runtimeMode: "wrap",
      agentScheduleCron: "0 9 * * *",
      agentScheduleEnabled: true,
    });
    expect(plan.skills).toHaveLength(1);
    expect(plan.skills[0]).toMatchObject({
      name: "main",
      scriptFilename: "main.py",
      code: "print('hi')\n",
    });
    expect(plan.quota).toEqual({
      perRunTokens: 10,
      perDayTokens: 20,
      billingTokens: 100,
      billingPeriod: "month",
    });
  });

  it("omits optional fields that are unset", () => {
    const manifest = manifestSchema.parse({
      name: "minimal",
      charter: "c",
      runtimeMode: "wrap",
      skills: { main: "main.py" },
      caps: { perRunTokens: 1, perDayTokens: 2 },
    });
    const plan = buildDeployPlan(manifest, agentDir);
    expect("agentScheduleCron" in plan.agent).toBe(false);
    expect("agentScheduleEnabled" in plan.agent).toBe(false);
    expect("billingTokens" in plan.quota).toBe(false);
  });

  it("sends script source in the platform's `code` field (BUG-067)", () => {
    const manifest = manifestSchema.parse({
      name: "deployer",
      charter: "Do things.",
      toolAllowlist: [],
      runtimeMode: "wrap",
      skills: { main: "main.py" },
      caps: { perRunTokens: 10, perDayTokens: 20 },
    });
    const plan = buildDeployPlan(manifest, agentDir);
    const skill = plan.skills[0] as unknown as Record<string, unknown>;
    expect(skill.code).toBe("print('hi')\n");
    expect(skill).not.toHaveProperty("scriptContent");
  });

  it("fails loudly when a skill script is missing on disk", () => {
    const manifest = manifestSchema.parse({
      name: "broken",
      charter: "c",
      runtimeMode: "wrap",
      skills: { main: "missing.py" },
      caps: { perRunTokens: 1, perDayTokens: 2 },
    });
    expect(() => buildDeployPlan(manifest, agentDir)).toThrow(/missing\.py/);
  });
});

describe("KohalaClient.upsertSkill (BUG-067)", () => {
  const payload = {
    name: "main",
    scriptFilename: "main.py",
    description: "d",
    code: "print('hi')\n",
  };

  it("succeeds when the platform confirms a production-stage script", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ skills: [], script: { imageId: 1, filename: "main.py", stage: "production", updated: true } }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const client = new KohalaClient("pk_test", "https://example.test");
      await expect(client.upsertSkill("316", payload)).resolves.toBeUndefined();
      const body = JSON.parse((fetchMock.mock.calls[0]?.[1] as RequestInit).body as string);
      expect(body.code).toBe("print('hi')\n");
      expect(body).not.toHaveProperty("scriptContent");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("fails loudly when no script asset is attached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => new Response(JSON.stringify({ skills: [] }), { status: 200 })),
    );
    try {
      const client = new KohalaClient("pk_test", "https://example.test");
      await expect(client.upsertSkill("316", payload)).rejects.toThrow(DeployError);
      await expect(client.upsertSkill("316", payload)).rejects.toThrow(/runnable script/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("KohalaClient.setSchedule (BUG-069 / BUG-077)", () => {
  it("PATCHes schedule fields incl. script bindings and accepts a confirmed round-trip", async () => {
    const fetchMock = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            id: 336,
            agentScheduleCron: "0 3 * * *",
            agentScheduleEnabled: true,
            agentScheduleEntries: [{ scriptFilename: "main.py", schedule: "0 3 * * *" }],
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const client = new KohalaClient("pk_test", "https://example.test");
      await expect(client.setSchedule("336", "0 3 * * *", ["main.py"])).resolves.toBeUndefined();
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://example.test/api/v1/agents/336");
      expect(init.method).toBe("PATCH");
      expect(JSON.parse(init.body as string)).toEqual({
        agentScheduleCron: "0 3 * * *",
        agentScheduleEnabled: true,
        agentScheduleEntries: [{ scriptFilename: "main.py", schedule: "0 3 * * *" }],
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("fails loudly when the platform does not persist the schedule", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        async () =>
          new Response(
            JSON.stringify({ id: 336, agentScheduleCron: null, agentScheduleEnabled: false }),
            { status: 200 },
          ),
      ),
    );
    try {
      const client = new KohalaClient("pk_test", "https://example.test");
      await expect(client.setSchedule("336", "0 3 * * *", ["main.py"])).rejects.toThrow(
        DeployError,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("fails loudly when a script is left unbound (BUG-077)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              id: 336,
              agentScheduleCron: "0 3 * * *",
              agentScheduleEnabled: true,
              agentScheduleEntries: [{ scriptFilename: "other.py", schedule: "0 3 * * *" }],
            }),
            { status: 200 },
          ),
      ),
    );
    try {
      const client = new KohalaClient("pk_test", "https://example.test");
      await expect(client.setSchedule("336", "0 3 * * *", ["main.py"])).rejects.toThrow(
        /not be bound/,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("setSchedule binding verification hardening (BUG-077 review)", () => {
  it("rejects bindings whose schedule does not match the requested cron", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        async () =>
          new Response(
            JSON.stringify({
              id: 336,
              agentScheduleCron: "0 3 * * *",
              agentScheduleEnabled: true,
              agentScheduleEntries: [{ scriptFilename: "main.py", schedule: "1 1 * * *" }],
            }),
            { status: 200 },
          ),
      ),
    );
    try {
      const client = new KohalaClient("pk_test", "https://example.test");
      await expect(client.setSchedule("336", "0 3 * * *", ["main.py"])).rejects.toThrow(
        /not be bound/,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("buildDeployPlan schedule/skills consistency (BUG-077 review)", () => {
  it("rejects a schedule with zero skills", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kohala-sched-"));
    try {
      const manifest = manifestSchema.parse({
        name: "sched-only",
        charter: "c",
        toolAllowlist: [],
        runtimeMode: "wrap",
        skills: {},
        caps: { perRunTokens: 1, perDayTokens: 2 },
        schedule: "0 3 * * *",
      });
      expect(() => buildDeployPlan(manifest, dir)).toThrow(/nothing_to_run|no skills/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("classifyManualRun409 (BUG-006)", () => {
  it("classifies the disabled-agent 409", () => {
    expect(
      classifyManualRun409(
        new DeployError(409, 'Kohala API error 409 on POST /x: {"error":"Agent is not enabled on this project"}'),
      ),
    ).toBe("disabled");
  });
  it("classifies the nothing_to_run 409", () => {
    expect(
      classifyManualRun409(
        new DeployError(
          409,
          'Kohala API error 409 on POST /x: {"error":"nothing_to_run","message":"...so a manual run would execute nothing..."}',
        ),
      ),
    ).toBe("nothing_to_run");
  });
  it("falls through to other for unknown 409s and non-409s", () => {
    expect(classifyManualRun409(new DeployError(409, "something else"))).toBe("other");
    expect(classifyManualRun409(new DeployError(500, "not enabled"))).toBe("other");
  });
});

describe("buildDeployPlan — TypeScript/JavaScript skills", () => {
  let agentDir: string;

  beforeEach(() => {
    agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "kohala-deploy-ts-"));
    fs.mkdirSync(path.join(agentDir, "skills"));
    fs.writeFileSync(path.join(agentDir, "skills", "main.ts"), "export async function run() {}\n");
    fs.writeFileSync(path.join(agentDir, "skills", "legacy.py"), "print('hi')\n");
  });
  afterEach(() => {
    fs.rmSync(agentDir, { recursive: true, force: true });
  });

  const manifestFor = (skills: Record<string, string>, dependencies?: string[]) =>
    manifestSchema.parse({
      name: "ts-agent",
      charter: "Do things.",
      toolAllowlist: ["s3.put"],
      runtimeMode: "wrap",
      skills,
      ...(dependencies ? { dependencies } : {}),
      caps: { perRunTokens: 10, perDayTokens: 20 },
    });

  it("declares the Node lane and the npm packages for a .ts skill", () => {
    const plan = buildDeployPlan(manifestFor({ main: "main.ts" }, ["zod"]), agentDir);
    expect(plan.skills[0]).toMatchObject({
      name: "main",
      scriptFilename: "main.ts",
      runtimeLanguage: "node",
      scriptDependencies: ["zod"],
      code: "export async function run() {}\n",
    });
  });

  it("omits scriptDependencies when none are declared", () => {
    const plan = buildDeployPlan(manifestFor({ main: "main.ts" }), agentDir);
    expect(plan.skills[0]?.runtimeLanguage).toBe("node");
    expect(plan.skills[0]).not.toHaveProperty("scriptDependencies");
  });

  it("leaves a Python skill's payload exactly as it was", () => {
    const plan = buildDeployPlan(manifestFor({ legacy: "legacy.py" }), agentDir);
    expect(Object.keys(plan.skills[0] ?? {}).sort()).toEqual([
      "code",
      "description",
      "name",
      "scriptFilename",
    ]);
  });

  it("sends the packages only with the Node skill of a mixed project", () => {
    const plan = buildDeployPlan(
      manifestFor({ main: "main.ts", legacy: "legacy.py" }, ["zod"]),
      agentDir,
    );
    const byName = Object.fromEntries(plan.skills.map((skill) => [skill.name, skill]));
    expect(byName.main?.scriptDependencies).toEqual(["zod"]);
    expect(byName.legacy).not.toHaveProperty("runtimeLanguage");
    expect(byName.legacy).not.toHaveProperty("scriptDependencies");
  });

  it("labels a planned upload's lane", () => {
    const plan = buildDeployPlan(manifestFor({ main: "main.ts", legacy: "legacy.py" }), agentDir);
    const byName = Object.fromEntries(plan.skills.map((skill) => [skill.name, skill]));
    expect(skillPayloadLanguage(byName.main!)).toBe("node");
    expect(skillPayloadLanguage(byName.legacy!)).toBe("python");
  });
});

describe("readableApiError", () => {
  it("surfaces the platform's message from a JSON error envelope", () => {
    const body = JSON.stringify({
      error:
        '[Kohala Security Service] Script rejected: unsupported npm dependencies for framework "custom": axios. Supported packages: zod',
      gateRejected: true,
      reasons: [{ kind: "dependency" }],
    });
    const message = readableApiError(body);
    expect(message).toContain("unsupported npm dependencies");
    expect(message).not.toContain("gateRejected");
  });

  it("joins error and message when the platform sends both", () => {
    expect(readableApiError(JSON.stringify({ error: "nothing_to_run", message: "no script" }))).toBe(
      "nothing_to_run — no script",
    );
  });

  it("falls back to the raw body when it is not a JSON envelope", () => {
    expect(readableApiError("<html>502</html>")).toBe("<html>502</html>");
    expect(readableApiError(JSON.stringify({ unexpected: true }))).toContain("unexpected");
  });
});

describe("KohalaClient.upsertSkill — gate rejection", () => {
  it("reports the platform's refusal message on a 400", async () => {
    const rejection =
      '[Kohala Security Service] Script rejected: unsupported npm dependencies for framework "custom": axios. Supported packages: zod';
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: rejection, gateRejected: true }), { status: 400 }),
        ),
    );
    try {
      const client = new KohalaClient("pk_test", "https://example.test");
      await expect(
        client.upsertSkill("316", {
          name: "main",
          scriptFilename: "main.ts",
          description: "d",
          code: "export {};",
          runtimeLanguage: "node",
          scriptDependencies: ["axios"],
        }),
      ).rejects.toThrow(/unsupported npm dependencies/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
