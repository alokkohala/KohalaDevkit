import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { evaluateValidators } from "../src/emulator/validators.js";
import { FileMemoryStore } from "../src/memory/file.js";

describe("evaluateValidators", () => {
  let root: string;
  let store: FileMemoryStore;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "kohala-val-"));
    store = new FileMemoryStore(root, "tester");
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("shape passes/fails on byte length", async () => {
    const pass = await evaluateValidators([{ type: "shape", minBytes: 3 }], "hello", store);
    expect(pass[0]?.passed).toBe(true);
    const fail = await evaluateValidators([{ type: "shape", minBytes: 100 }], "hi", store);
    expect(fail[0]?.passed).toBe(false);
  });

  it("freshness fails when the asset is missing", async () => {
    const results = await evaluateValidators(
      [{ type: "freshness", asset: "nope", maxAgeHours: 1 }],
      "out",
      store,
    );
    expect(results[0]?.passed).toBe(false);
    expect(results[0]?.detail).toContain("does not exist");
  });

  it("freshness passes for a fresh asset and fails for a stale one", async () => {
    await store.put("fresh", Buffer.from("x"));
    const fresh = await evaluateValidators(
      [{ type: "freshness", asset: "fresh", maxAgeHours: 1 }],
      "out",
      store,
    );
    expect(fresh[0]?.passed).toBe(true);

    const staleCheck = await evaluateValidators(
      [{ type: "freshness", asset: "fresh", maxAgeHours: 1 }],
      "out",
      store,
      new Date(Date.now() + 2 * 3_600_000),
    );
    expect(staleCheck[0]?.passed).toBe(false);
  });

  it("invariant honors mustMatch in both directions", async () => {
    const [mustMatchPass] = await evaluateValidators(
      [{ type: "invariant", pattern: "\\d+", mustMatch: true }],
      "value 42",
      store,
    );
    expect(mustMatchPass?.passed).toBe(true);

    const [mustNotMatchFail] = await evaluateValidators(
      [{ type: "invariant", pattern: "error", mustMatch: false }],
      "an error occurred",
      store,
    );
    expect(mustNotMatchFail?.passed).toBe(false);
  });

  it("invariant reports invalid regexes as failures, not crashes", async () => {
    const [result] = await evaluateValidators(
      [{ type: "invariant", pattern: "([", mustMatch: true }],
      "out",
      store,
    );
    expect(result?.passed).toBe(false);
    expect(result?.detail).toContain("invalid regex");
  });

  it("evaluates all validators without short-circuiting", async () => {
    const results = await evaluateValidators(
      [
        { type: "shape", minBytes: 1000 },
        { type: "invariant", pattern: "x", mustMatch: true },
      ],
      "x",
      store,
    );
    expect(results.length).toBe(2);
    expect(results[0]?.passed).toBe(false);
    expect(results[1]?.passed).toBe(true);
  });
});
