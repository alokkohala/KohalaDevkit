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
  /**
   * setSchedule with scripts to bind makes TWO requests: a GET to read the
   * agent's current entries (so out-of-band bindings survive the
   * replacement-array PATCH) followed by the PATCH itself. This helper
   * stubs fetch to answer both.
   */
  function stubScheduleFetch(opts: {
    currentEntries?: unknown;
    patchResponse: Record<string, unknown>;
  }) {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      if (!init || init.method === "GET" || init.method === undefined) {
        return new Response(
          JSON.stringify({ id: 336, agentScheduleEntries: opts.currentEntries ?? null }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify(opts.patchResponse), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  function patchCall(fetchMock: ReturnType<typeof vi.fn>): [string, RequestInit] {
    const call = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "PATCH",
    );
    if (!call) throw new Error("no PATCH request was made");
    return call as [string, RequestInit];
  }

  it("PATCHes canonical schedule fields, binds the scripts, and accepts a confirmed round-trip", async () => {
    const fetchMock = stubScheduleFetch({
      patchResponse: {
        id: 336,
        agentScheduleCron: "0 3 * * *",
        agentScheduleEnabled: true,
        agentScheduleEntries: [{ scriptFilename: "main.py", schedule: "0 3 * * *" }],
      },
    });
    try {
      const client = new KohalaClient("pk_test", "https://example.test");
      await expect(client.setSchedule("336", "0 3 * * *", ["main.py"])).resolves.toBeUndefined();
      const [url, init] = patchCall(fetchMock);
      expect(url).toBe("https://example.test/api/v1/agents/336");
      expect(JSON.parse(init.body as string)).toEqual({
        agentScheduleCron: "0 3 * * *",
        agentScheduleEnabled: true,
        agentScheduleEntries: [{ scriptFilename: "main.py", schedule: "0 3 * * *" }],
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("preserves bindings made outside the CLI (additive deploy)", async () => {
    const fetchMock = stubScheduleFetch({
      currentEntries: [
        { scriptFilename: "ops.py", schedule: "0 6 * * *" },
        { scriptFilename: "main.py", schedule: "0 1 * * *" }, // ours — re-bound
      ],
      patchResponse: {
        id: 336,
        agentScheduleCron: "0 3 * * *",
        agentScheduleEnabled: true,
        agentScheduleEntries: [
          { scriptFilename: "ops.py", schedule: "0 6 * * *" },
          { scriptFilename: "main.py", schedule: "0 3 * * *" },
        ],
      },
    });
    try {
      const client = new KohalaClient("pk_test", "https://example.test");
      await client.setSchedule("336", "0 3 * * *", ["main.py"]);
      const [, init] = patchCall(fetchMock);
      expect(JSON.parse(init.body as string).agentScheduleEntries).toEqual([
        { scriptFilename: "ops.py", schedule: "0 6 * * *" }, // untouched
        { scriptFilename: "main.py", schedule: "0 3 * * *" }, // manifest cron wins
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("dedupes script filenames and binds each one once", async () => {
    const fetchMock = stubScheduleFetch({
      patchResponse: {
        id: 336,
        agentScheduleCron: "0 3 * * *",
        agentScheduleEnabled: true,
        agentScheduleEntries: [
          { scriptFilename: "main.py", schedule: "0 3 * * *" },
          { scriptFilename: "other.py", schedule: "0 3 * * *" },
        ],
      },
    });
    try {
      const client = new KohalaClient("pk_test", "https://example.test");
      await client.setSchedule("336", "0 3 * * *", ["main.py", "other.py", "main.py"]);
      const [, init] = patchCall(fetchMock);
      expect(JSON.parse(init.body as string).agentScheduleEntries).toEqual([
        { scriptFilename: "main.py", schedule: "0 3 * * *" },
        { scriptFilename: "other.py", schedule: "0 3 * * *" },
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("omits agentScheduleEntries entirely when there are no scripts to bind (single request)", async () => {
    const fetchMock = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ id: 336, agentScheduleCron: "0 3 * * *", agentScheduleEnabled: true }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const client = new KohalaClient("pk_test", "https://example.test");
      await expect(client.setSchedule("336", "0 3 * * *", [])).resolves.toBeUndefined();
      // No scripts → no merge needed → no GET, just the PATCH.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(init.method).toBe("PATCH");
      expect(JSON.parse(init.body as string)).not.toHaveProperty("agentScheduleEntries");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("fails loudly when the platform does not persist the schedule", async () => {
    stubScheduleFetch({
      patchResponse: { id: 336, agentScheduleCron: null, agentScheduleEnabled: false },
    });
    try {
      const client = new KohalaClient("pk_test", "https://example.test");
      await expect(client.setSchedule("336", "0 3 * * *", ["main.py"])).rejects.toThrow(
        DeployError,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("fails loudly when the cron persists but the script binding does not (BUG-077)", async () => {
    // The exact field state observed on agent 348: cron + enabled stored,
    // agentScheduleEntries null — the agent looks complete but 409s
    // nothing_to_run on every trigger.
    stubScheduleFetch({
      patchResponse: {
        id: 348,
        agentScheduleCron: "0 3 29 2 *",
        agentScheduleEnabled: true,
        agentScheduleEntries: null,
      },
    });
    try {
      const client = new KohalaClient("pk_test", "https://example.test");
      await expect(client.setSchedule("348", "0 3 29 2 *", ["main.py"])).rejects.toThrow(
        /did not bind/,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("fails loudly when the binding round-trips with a stale schedule", async () => {
    stubScheduleFetch({
      patchResponse: {
        id: 336,
        agentScheduleCron: "0 3 * * *",
        agentScheduleEnabled: true,
        // Entry exists but kept an old cron — same silent no-run failure.
        agentScheduleEntries: [{ scriptFilename: "main.py", schedule: "0 9 * * *" }],
      },
    });
    try {
      const client = new KohalaClient("pk_test", "https://example.test");
      await expect(client.setSchedule("336", "0 3 * * *", ["main.py"])).rejects.toThrow(
        /did not bind/,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
