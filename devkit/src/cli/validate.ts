import path from "node:path";
import type { Command } from "commander";
import pc from "picocolors";
import { loadManifest, ManifestError } from "../manifest/load.js";
import { unknownToolIds } from "../manifest/known-tools.js";
import { LANGUAGE_LABEL, skillLanguages, summarizeLanguages } from "../manifest/language.js";
import { npmAllowlistMessage, rejectedNpmPackages } from "../manifest/npm-packages.js";

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
    .option(
      "--allow-unknown-packages",
      "do not fail on npm packages missing from the bundled allowlist snapshot",
    )
    .description("Validate an agent's kohala.json and print precise errors")
    .action(
      (agent: string, options: { allowUnknownTools?: boolean; allowUnknownPackages?: boolean }) => {
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

          // Declared npm packages, checked against the same allowlist the
          // platform's attach-time gate enforces — a package it would refuse
          // is a deploy that fails, so say so here with the platform's words.
          const rejected = rejectedNpmPackages(manifest.dependencies);
          if (rejected.length > 0) {
            const msg = npmAllowlistMessage(rejected);
            if (options.allowUnknownPackages) {
              console.warn(pc.yellow(`warning: ${msg}`));
            } else {
              console.error(pc.red(msg));
              console.error(
                pc.dim(
                  "  The platform refuses these when the script is attached, so deploy would fail. Remove them, or re-run with --allow-unknown-packages if the bundled snapshot is stale (the deploy endpoint still enforces the live allowlist).",
                ),
              );
              process.exitCode = 1;
              return;
            }
          }

          console.log(pc.green(`kohala.json for "${manifest.name}" is valid.`));
          console.log(
            pc.dim(
              `  runtimeMode=${manifest.runtimeMode} language=${summarizeLanguages(manifest.skills)} ` +
                `skills=${Object.keys(manifest.skills).length} ` +
                `validators=${manifest.validators.length} allowlist=[${manifest.toolAllowlist.join(", ")}]`,
            ),
          );
          // Name the lane per skill: the extension decides which runtime the
          // platform spawns, and that is not obvious from the manifest alone.
          for (const skill of skillLanguages(manifest.skills)) {
            console.log(
              pc.dim(
                `  skill "${skill.name}" → skills/${skill.scriptFilename} (${LANGUAGE_LABEL[skill.language]})`,
              ),
            );
          }
          if (manifest.dependencies.length > 0) {
            console.log(pc.dim(`  npm packages: ${manifest.dependencies.join(", ")}`));
          }
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
      },
    );
}
