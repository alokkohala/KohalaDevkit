import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TraceWriter, traceFilePath } from "../src/trace/writer.js";
import { parseTraceLines, readTraceFile } from "../src/trace/reader.js";
import { formatTraceEvent } from "../src/trace/format.js";
import type { TraceEvent } from "../src/trace/events.js";

const BASE = { ts: new Date().toISOString(), runId: "run_x", agent: "tester" };

describe("trace writer/reader", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "kohala-trace-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("appends JSONL events that round-trip through the reader", () => {
    const writer = new TraceWriter(root, "tester");
    const events: TraceEvent[] = [
      { ...BASE, type: "run_started", runtimeMode: "wrap", skill: "main", scriptFilename: "main.py" },
      {
        ...BASE,
        type: "tool_call",
        tool: "s3.put",
        argsSummary: "{}",
        allowed: true,
        ok: true,
        durationMs: 3,
      },
      { ...BASE, type: "run_finished", status: "succeeded", totalTokens: 0, durationMs: 10 },
    ];
    for (const event of events) writer.append(event);
    const read = readTraceFile(traceFilePath(root, "tester"));
    expect(read).toEqual(events);
  });

  it("throws loudly on malformed lines", () => {
    expect(() => parseTraceLines('{"type":"run_started"}\nnot json\n')).toThrow(/Malformed trace line 2/);
  });

  it("formats every event type without crashing", () => {
    const events: TraceEvent[] = [
      { ...BASE, type: "run_started", runtimeMode: "llm", skill: "s", scriptFilename: "f" },
      {
        ...BASE,
        type: "tool_call",
        tool: "s3.get",
        argsSummary: "{}",
        allowed: false,
        ok: false,
        durationMs: 1,
        error: "TOOL_DENIED",
      },
      { ...BASE, type: "tokens", tokens: 5, runTotal: 5, dayTotal: 5, source: "test" },
      { ...BASE, type: "validator_result", validator: "shape", passed: false, detail: "too small" },
      { ...BASE, type: "repair_attempt", attempt: 1, maxAttempts: 2, reason: "shape failed" },
      { ...BASE, type: "run_finished", status: "failed", totalTokens: 5, durationMs: 9, detail: "d" },
    ];
    for (const event of events) {
      expect(formatTraceEvent(event)).toBeTruthy();
    }
  });
});
