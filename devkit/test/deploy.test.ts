import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildDeployPlan } from "../src/deploy/client.js";
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
      scriptContent: "print('hi')\n",
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
