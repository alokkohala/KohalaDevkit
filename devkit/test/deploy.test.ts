import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import { buildDeployPlan, DeployError, KohalaClient } from "../src/deploy/client.js";
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
      schedule: "0 9 * * *",
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
    expect("schedule" in plan.agent).toBe(false);
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
