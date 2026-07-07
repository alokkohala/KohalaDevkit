import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ToolDispatcher } from "../src/sdk/dispatch.js";
import { startSdkRpcServer } from "../src/sdk/rpc.js";
import { FileMemoryStore } from "../src/memory/file.js";
import { TokenMeter } from "../src/emulator/tokens.js";
import { TraceWriter } from "../src/trace/writer.js";
import { readTraceFile } from "../src/trace/reader.js";
import { manifestSchema, type AgentManifest } from "../src/manifest/schema.js";

function makeContext(root: string, allowlist: string[]) {
  const manifest: AgentManifest = manifestSchema.parse({
    name: "tester",
    charter: "test",
    toolAllowlist: allowlist,
    runtimeMode: "wrap",
    skills: { main: "main.py" },
    caps: { perRunTokens: 1000, perDayTokens: 5000 },
  });
  return {
    manifest,
    store: new FileMemoryStore(root, "tester"),
    trace: new TraceWriter(root, "tester"),
    meter: new TokenMeter(root, "tester", manifest.caps),
    runId: "run_test",
  };
}

describe("ToolDispatcher", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "kohala-disp-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("denies tools not on the allowlist and records the denial in the trace", async () => {
    const context = makeContext(root, ["s3.put"]);
    const dispatcher = new ToolDispatcher(context);
    await expect(dispatcher.call("s3.get", { keyOrId: "x" })).rejects.toMatchObject({
      code: "TOOL_DENIED",
    });
    const events = readTraceFile(path.join(root, ".kohala", "trace", "tester.jsonl"));
    const denied = events.find((event) => event.type === "tool_call");
    expect(denied).toMatchObject({ allowed: false, ok: false });
  });

  it("executes memory tools end to end", async () => {
    const context = makeContext(root, ["s3.put", "s3.get", "s3.list", "s3.delete"]);
    const dispatcher = new ToolDispatcher(context);
    await dispatcher.call("s3.put", { key: "k", body: "v" });
    const got = (await dispatcher.call("s3.get", { keyOrId: "k" })) as { body: string };
    expect(got.body).toBe("v");
    const listed = (await dispatcher.call("s3.list", {})) as { records: unknown[] };
    expect(listed.records.length).toBe(1);
    await dispatcher.call("s3.delete", { keyOrId: "k" });
    await expect(dispatcher.call("s3.get", { keyOrId: "k" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("blocks private hosts in http.post_json", async () => {
    const context = makeContext(root, ["http.post_json"]);
    const dispatcher = new ToolDispatcher(context);
    for (const url of [
      "http://127.0.0.1/x",
      "http://localhost/x",
      "http://10.0.0.5/x",
      "http://192.168.1.1/x",
      "http://169.254.169.254/latest/meta-data",
    ]) {
      await expect(dispatcher.call("http.post_json", { url, body: {} })).rejects.toMatchObject({
        code: "BLOCKED_HOST",
      });
    }
  });

  it("rejects non-http URLs", async () => {
    const context = makeContext(root, ["http.post_json"]);
    const dispatcher = new ToolDispatcher(context);
    await expect(
      dispatcher.call("http.post_json", { url: "file:///etc/passwd", body: {} }),
    ).rejects.toMatchObject({ code: "BAD_URL" });
  });

  it("fails llm.complete loudly when no key is configured", async () => {
    const savedAnthropic = process.env.ANTHROPIC_API_KEY;
    const savedGemini = process.env.GEMINI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
      const context = makeContext(root, ["llm.complete"]);
      // Generous cap so the per-run projection passes and we reach the key check.
      context.manifest.caps.perRunTokens = 100000;
      const dispatcher = new ToolDispatcher(context);
      await expect(dispatcher.call("llm.complete", { prompt: "hi" })).rejects.toThrow(/NO_LLM_KEY/);
    } finally {
      if (savedAnthropic) process.env.ANTHROPIC_API_KEY = savedAnthropic;
      if (savedGemini) process.env.GEMINI_API_KEY = savedGemini;
    }
  });

  it("aborts llm.complete with PER_RUN_TOKEN_CAP before crossing the cap", async () => {
    const context = makeContext(root, ["llm.complete"]);
    context.manifest.caps.perRunTokens = 10; // any turn projects > 10
    const dispatcher = new ToolDispatcher(context);
    await expect(dispatcher.call("llm.complete", { prompt: "hi" })).rejects.toMatchObject({
      code: "PER_RUN_TOKEN_CAP",
    });
  });

  it("validates arguments", async () => {
    const context = makeContext(root, ["s3.put", "metrics.record"]);
    const dispatcher = new ToolDispatcher(context);
    await expect(dispatcher.call("s3.put", { key: "k" })).rejects.toMatchObject({ code: "BAD_ARGS" });
    await expect(
      dispatcher.call("metrics.record", { name: "m", value: "high" }),
    ).rejects.toMatchObject({ code: "BAD_ARGS" });
  });
});

describe("SDK RPC server", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "kohala-rpc-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("serves tool calls over loopback HTTP with the ok/error envelope", async () => {
    const context = makeContext(root, ["s3.put", "s3.get"]);
    const rpc = await startSdkRpcServer(context);
    try {
      const putResponse = await fetch(rpc.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tool: "s3.put", args: { key: "k", body: "v" } }),
      });
      const putBody = (await putResponse.json()) as { ok: boolean };
      expect(putBody.ok).toBe(true);

      const deniedResponse = await fetch(rpc.url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tool: "s3.list", args: {} }),
      });
      const deniedBody = (await deniedResponse.json()) as {
        ok: boolean;
        error: { code: string };
      };
      expect(deniedBody.ok).toBe(false);
      expect(deniedBody.error.code).toBe("TOOL_DENIED");

      const badJson = await fetch(rpc.url, { method: "POST", body: "{nope" });
      const badJsonBody = (await badJson.json()) as { ok: boolean; error: { code: string } };
      expect(badJsonBody.error.code).toBe("BAD_JSON");
    } finally {
      await rpc.close();
    }
  });
});
