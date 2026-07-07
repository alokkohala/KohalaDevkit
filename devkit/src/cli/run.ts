import path from "node:path";
import type { Command } from "commander";
import pc from "picocolors";
import { loadManifest } from "../manifest/load.js";
import { createMemoryStore } from "../memory/create.js";
import { runShift } from "../emulator/runner.js";

/**
 * `kohala run <agent> --local` — run one shift against the local emulator.
 *
 * Local runs are always manual (the manifest's schedule only matters on
 * deploy). The emulator enforces admission, allowlist, caps, and validators
 * exactly like the hosted platform, but never meters anything.
 */
export function registerRunCommand(program: Command): void {
  program
    .command("run")
    .argument("<agent>", "agent directory (containing kohala.json)")
    .option("--local", "run against the local emulator (required for now)")
    .option("--skill <name>", "which skill to run (defaults to the only skill)")
    .option(
      "--backend <backend>",
      "memory backend for this run: file | postgres",
      "file",
    )
    .option("--url <url>", "postgres connection string (or set DATABASE_URL)")
    .description("Run a shift against the local emulator")
    .action(
      async (
        agent: string,
        options: { local?: boolean; skill?: string; backend: string; url?: string },
      ) => {
        if (!options.local) {
          throw new Error(
            "Hosted runs start from the platform, not the CLI. Use --local to run against the local emulator, or `kohala deploy --run` to trigger a hosted run.",
          );
        }
        if (options.backend !== "file" && options.backend !== "postgres") {
          throw new Error(`Unknown backend "${options.backend}" — use "file" or "postgres".`);
        }
        const rootDir = process.cwd();
        const agentDir = path.resolve(rootDir, agent);
        const manifest = loadManifest(agentDir);
        const store = await createMemoryStore({
          backend: options.backend,
          agent: manifest.name,
          rootDir,
          url: options.url ?? process.env.DATABASE_URL,
        });

        try {
          console.log(
            pc.cyan(`Running shift for "${manifest.name}" (${manifest.runtimeMode} mode)...`),
          );
          const result = await runShift({ rootDir, agentDir, manifest, store, skill: options.skill });

          console.log("");
          if (result.status === "succeeded") {
            console.log(pc.green(`✔ Shift ${result.runId} succeeded`));
          } else {
            console.log(pc.red(`✘ Shift ${result.runId} ${result.status.replace(/_/g, " ")}`));
            if (result.detail) console.log(pc.red(`  ${result.detail}`));
          }
          console.log(pc.dim(`  tokens used: ${result.totalTokens} (counted, never billed)`));
          for (const validator of result.validatorResults) {
            const mark = validator.passed ? pc.green("passed") : pc.red("failed");
            console.log(pc.dim(`  validator ${validator.validator}: `) + mark + pc.dim(` — ${validator.detail}`));
          }
          if (result.output.trim() !== "") {
            console.log("");
            console.log(pc.dim("── output ─────────────────────────────"));
            console.log(result.output.trim());
          }
          console.log("");
          console.log(pc.dim(`Full audit trail: kohala trace ${agent}`));
          if (result.status !== "succeeded") {
            process.exitCode = 1;
          }
        } finally {
          await store.close();
        }
      },
    );
}
