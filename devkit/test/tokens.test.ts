import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CapExceededError, estimateTokens, TokenMeter } from "../src/emulator/tokens.js";

const CAPS = { perRunTokens: 100, perDayTokens: 200 };

describe("TokenMeter", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "kohala-tok-"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("estimates ~4 chars per token", () => {
    expect(estimateTokens("abcdefgh")).toBe(2);
    expect(estimateTokens("abc")).toBe(1);
    expect(estimateTokens("")).toBe(0);
  });

  it("admits a run under the day cap and persists usage across meters", () => {
    const meter = new TokenMeter(root, "a", CAPS);
    meter.admitRun();
    meter.add(150);
    const secondMeter = new TokenMeter(root, "a", CAPS);
    expect(secondMeter.dayTotal()).toBe(150);
    secondMeter.admitRun(); // 150 < 200, still admitted
  });

  it("refuses admission with PER_DAY_TOKEN_CAP once the day cap is spent", () => {
    const meter = new TokenMeter(root, "a", CAPS);
    meter.add(200);
    const secondMeter = new TokenMeter(root, "a", CAPS);
    try {
      secondMeter.admitRun();
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(CapExceededError);
      expect((error as CapExceededError).code).toBe("PER_DAY_TOKEN_CAP");
      expect(secondMeter.abortedWith).toBe(error);
    }
  });

  it("aborts a turn with PER_RUN_TOKEN_CAP before crossing the per-run cap", () => {
    const meter = new TokenMeter(root, "a", CAPS);
    meter.add(80);
    meter.admitLlmTurn(20); // exactly at the cap is fine
    expect(() => meter.admitLlmTurn(21)).toThrowError(CapExceededError);
    expect(meter.abortedWith?.code).toBe("PER_RUN_TOKEN_CAP");
  });

  it("keeps usage separate per agent", () => {
    new TokenMeter(root, "a", CAPS).add(50);
    expect(new TokenMeter(root, "b", CAPS).dayTotal()).toBe(0);
  });
});
