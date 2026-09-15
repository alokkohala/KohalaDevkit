import { describe, expect, it } from "vitest";
import {
  hasNodeSkill,
  languageForEntrypointFile,
  skillLanguages,
  summarizeLanguages,
} from "../src/manifest/language.js";
import {
  ALLOWED_NPM_PACKAGES,
  npmAllowlistMessage,
  rejectedNpmPackages,
} from "../src/manifest/npm-packages.js";

describe("languageForEntrypointFile", () => {
  it("maps Python and TypeScript/JavaScript extensions onto their lanes", () => {
    expect(languageForEntrypointFile("main.py")).toBe("python");
    for (const file of [
      "agent.ts",
      "agent.mts",
      "agent.cts",
      "agent.js",
      "agent.mjs",
      "agent.cjs",
    ]) {
      expect(languageForEntrypointFile(file)).toBe("node");
    }
  });

  it("is case-insensitive about the extension", () => {
    expect(languageForEntrypointFile("MAIN.PY")).toBe("python");
    expect(languageForEntrypointFile("Agent.TS")).toBe("node");
  });

  it("returns null for anything the platform cannot run", () => {
    expect(languageForEntrypointFile("main.rb")).toBeNull();
    expect(languageForEntrypointFile("main")).toBeNull();
    expect(languageForEntrypointFile("")).toBeNull();
  });
});

describe("skill language summary", () => {
  it("reports each skill's lane", () => {
    expect(skillLanguages({ collect: "main.py", report: "report.ts" })).toEqual([
      { name: "collect", scriptFilename: "main.py", language: "python" },
      { name: "report", scriptFilename: "report.ts", language: "node" },
    ]);
  });

  it("summarizes single-lane and mixed projects", () => {
    expect(summarizeLanguages({ a: "a.py" })).toBe("python");
    expect(summarizeLanguages({ a: "a.ts" })).toBe("node");
    expect(summarizeLanguages({ a: "a.py", b: "b.ts" })).toBe("mixed");
    expect(summarizeLanguages({})).toBe("none");
  });

  it("detects whether any skill needs the Node lane", () => {
    expect(hasNodeSkill({ a: "a.py" })).toBe(false);
    expect(hasNodeSkill({ a: "a.py", b: "b.js" })).toBe(true);
  });
});

describe("npm allowlist snapshot", () => {
  it("accepts allowlisted packages (case/whitespace tolerant)", () => {
    expect(rejectedNpmPackages(["zod", " Openai ", "@ai-sdk/openai"])).toEqual([]);
    expect(rejectedNpmPackages([])).toEqual([]);
  });

  it("rejects packages the platform will not install", () => {
    expect(rejectedNpmPackages(["axios", "zod", "left-pad"])).toEqual(["axios", "left-pad"]);
  });

  it("reports a rejection with the platform's own sentence", () => {
    const message = npmAllowlistMessage(["axios"]);
    expect(message).toContain('unsupported npm dependencies for framework "custom": axios');
    expect(message).toContain("Supported packages:");
    for (const pkg of ALLOWED_NPM_PACKAGES) {
      expect(message).toContain(pkg);
    }
  });
});
