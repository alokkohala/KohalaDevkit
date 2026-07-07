import type { Command } from "commander";
import pc from "picocolors";
import { findPython } from "../emulator/python.js";
import { detectLlmProvider } from "../emulator/llm-client.js";
import { resolveApiKey, credentialsPath } from "../deploy/credentials.js";

/**
 * `kohala doctor` — check the local environment and report what works.
 * Nothing here is fatal; the doctor tells you what each missing piece limits.
 */
export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Check your environment: Node, Python, LLM keys, API key, DATABASE_URL")
    .action(async () => {
      const ok = (label: string, detail: string) =>
        console.log(`${pc.green("✔")} ${label} ${pc.dim(detail)}`);
      const warn = (label: string, detail: string) =>
        console.log(`${pc.yellow("•")} ${label} ${pc.dim(detail)}`);

      // Node version (package.json engines requires >= 20).
      const nodeMajor = Number(process.versions.node.split(".")[0]);
      if (nodeMajor >= 20) {
        ok(`node ${process.versions.node}`, "(>= 20 required)");
      } else {
        console.log(
          `${pc.red("✘")} node ${process.versions.node} — the devkit requires Node 20 or newer.`,
        );
      }

      // Python (needed to run wrap-mode skills).
      try {
        const python = await findPython();
        ok(`python (${python})`, "wrap-mode skills can run");
      } catch {
        warn("python 3 not found", "wrap-mode `kohala run --local` will not work until installed");
      }

      // LLM keys (needed for llm.complete and llm mode).
      const provider = detectLlmProvider();
      if (provider) {
        ok(`LLM key (${provider})`, "llm.complete and llm mode available");
      } else {
        warn(
          "no ANTHROPIC_API_KEY / GEMINI_API_KEY",
          "llm.complete and llm-mode runs will fail with NO_LLM_KEY",
        );
      }

      // Kohala API key (needed only for deploy).
      const apiKey = resolveApiKey();
      if (apiKey) {
        const source = process.env.KOHALA_API_KEY ? "KOHALA_API_KEY env" : credentialsPath();
        ok("Kohala API key", `from ${source} — kohala deploy ready`);
      } else {
        warn("no Kohala API key", "run `kohala login` before `kohala deploy` (local dev needs no account)");
      }

      // DATABASE_URL (needed only for the postgres memory backend).
      if (process.env.DATABASE_URL) {
        ok("DATABASE_URL set", "postgres memory backend available");
      } else {
        warn("DATABASE_URL not set", "memory uses the file backend (that is the default anyway)");
      }

      console.log("");
      console.log(pc.dim("Everything local works without an account — deploy is the only step that needs one."));
    });
}
