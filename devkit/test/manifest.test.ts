import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadManifest, ManifestError } from "../src/manifest/load.js";
import { manifestSchema } from "../src/manifest/schema.js";

const VALID = {
  name: "test-agent",
  charter: "Do a thing.",
  toolAllowlist: ["s3.put"],
  runtimeMode: "wrap",
  skills: { main: "main.py" },
  caps: { perRunTokens: 1000, perDayTokens: 5000 },
  validators: [{ type: "shape", minBytes: 5 }],
};

describe("manifestSchema", () => {
  it("accepts a valid manifest and applies defaults", () => {
    const parsed = manifestSchema.parse({ ...VALID, toolAllowlist: undefined, validators: undefined });
    expect(parsed.toolAllowlist).toEqual([]);
    expect(parsed.validators).toEqual([]);
  });

  it("rejects unknown top-level keys (strict)", () => {
    const result = manifestSchema.safeParse({ ...VALID, tools: ["s3.put"] });
    expect(result.success).toBe(false);
  });

  it("rejects bad runtimeMode", () => {
    const result = manifestSchema.safeParse({ ...VALID, runtimeMode: "auto" });
    expect(result.success).toBe(false);
  });

  it("requires billingPeriod when billingTokens is set", () => {
    const result = manifestSchema.safeParse({
      ...VALID,
      caps: { perRunTokens: 1, perDayTokens: 1, billingTokens: 100 },
    });
    expect(result.success).toBe(false);
  });

  it("defaults invariant mustMatch to true", () => {
    const parsed = manifestSchema.parse({
      ...VALID,
      validators: [{ type: "invariant", pattern: "ok" }],
    });
    expect(parsed.validators[0]).toMatchObject({ type: "invariant", mustMatch: true });
  });

  it("rejects invalid agent names", () => {
    for (const name of ["", "-bad", "has space", "a".repeat(65)]) {
      expect(manifestSchema.safeParse({ ...VALID, name }).success).toBe(false);
    }
  });
});

describe("loadManifest", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kohala-manifest-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("loads a valid kohala.json", () => {
    fs.writeFileSync(path.join(dir, "kohala.json"), JSON.stringify(VALID));
    expect(loadManifest(dir).name).toBe("test-agent");
  });

  it("fails loudly when the file is missing", () => {
    expect(() => loadManifest(dir)).toThrowError(ManifestError);
  });

  it("reports JSON syntax errors with a hint", () => {
    fs.writeFileSync(path.join(dir, "kohala.json"), "{ not json");
    try {
      loadManifest(dir);
      expect.unreachable();
    } catch (error) {
      expect((error as ManifestError).problems.join(" ")).toContain("trailing commas");
    }
  });

  it("includes per-field fix hints in validation problems", () => {
    fs.writeFileSync(
      path.join(dir, "kohala.json"),
      JSON.stringify({ ...VALID, caps: { perRunTokens: "many", perDayTokens: 5 } }),
    );
    try {
      loadManifest(dir);
      expect.unreachable();
    } catch (error) {
      const problems = (error as ManifestError).problems.join("\n");
      expect(problems).toContain("caps.perRunTokens");
      expect(problems).toContain("hint:");
    }
  });
});
