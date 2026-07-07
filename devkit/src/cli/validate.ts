import path from "node:path";
import type { Command } from "commander";
import pc from "picocolors";
import { loadManifest, ManifestError } from "../manifest/load.js";

/**
 * `kohala validate <agent>` — load and validate the agent's kohala.json,
 * printing every problem with a fix hint. Exit code 1 on any problem.
 */
export function registerValidateCommand(program: Command): void {
  program
    .command("validate")
    .argument("<agent>", "agent directory (containing kohala.json)")
    .description("Validate an agent's kohala.json and print precise errors")
    .action((agent: string) => {
      const agentDir = path.resolve(process.cwd(), agent);
      try {
        const manifest = loadManifest(agentDir);
        console.log(pc.green(`kohala.json for "${manifest.name}" is valid.`));
        console.log(
          pc.dim(
            `  runtimeMode=${manifest.runtimeMode} skills=${Object.keys(manifest.skills).length} ` +
              `validators=${manifest.validators.length} allowlist=[${manifest.toolAllowlist.join(", ")}]`,
          ),
        );
      } catch (error) {
        if (error instanceof ManifestError) {
          console.error(pc.red(error.message));
          for (const problem of error.problems) {
            console.error(pc.red(`  • ${problem}`));
          }
          process.exitCode = 1;
          return;
        }
        throw error;
      }
    });
}
