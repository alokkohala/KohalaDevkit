import path from "node:path";
import type { Command } from "commander";
import pc from "picocolors";
import { loadManifest, ManifestError } from "../manifest/load.js";
import { unknownToolIds } from "../manifest/known-tools.js";

/**
 * `kohala validate <agent>` — load and validate the agent's kohala.json,
 * printing every problem with a fix hint. Exit code 1 on any problem.
 */
export function registerValidateCommand(program: Command): void {
  program
    .command("validate")
    .argument("<agent>", "agent directory (containing kohala.json)")
    .option(
      "--allow-unknown-tools",
      "do not fail on tool ids missing from the bundled catalog snapshot",
    )
    .description("Validate an agent's kohala.json and print precise errors")
    .action((agent: string, options: { allowUnknownTools?: boolean }) => {
      const agentDir = path.resolve(process.cwd(), agent);
      try {
        const manifest = loadManifest(agentDir);
        // Catch typo'd / unknown tool ids offline, mirroring the server-side
        // deploy gate (which enforces the live catalog authoritatively).
        const unknown = unknownToolIds(manifest.toolAllowlist);
        if (unknown.length > 0) {
          const msg =
            `toolAllowlist contains tool id(s) not in the Kohala tool catalog: ` +
            unknown.join(", ");
          if (options.allowUnknownTools) {
            console.warn(pc.yellow(`warning: ${msg}`));
          } else {
            console.error(pc.red(msg));
            console.error(
              pc.dim(
                "  If these are new platform tools the bundled snapshot doesn't know yet, re-run with --allow-unknown-tools (the deploy endpoint will still verify against the live catalog).",
              ),
            );
            process.exitCode = 1;
            return;
          }
        }
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
