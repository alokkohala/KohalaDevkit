import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Command } from "commander";
import pc from "picocolors";
import { manifestSchema } from "../manifest/schema.js";

/**
 * `kohala init <name>` — scaffold a new agent from templates/.
 *
 * The scaffold is a complete, runnable agent: kohala.json, skills/main.py (a
 * working example that writes to memory), skills/_tools.py (the local SDK),
 * and a README. `kohala run <name> --local` works immediately after init.
 */

/** Locate the templates directory relative to the built CLI bundle. */
function templatesDir(): string {
  // dist/cli/index.js -> ../../templates ; src/cli/init.ts -> ../../templates
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "..", "..", "templates"),
    path.resolve(here, "..", "..", "..", "templates"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, "kohala.json"))) return candidate;
  }
  throw new Error(`Could not locate the devkit templates directory (looked in: ${candidates.join(", ")})`);
}

/** Recursively copy the template tree, substituting {{AGENT_NAME}}. */
function copyTemplates(sourceDir: string, targetDir: string, agentName: string): void {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      copyTemplates(sourcePath, targetPath, agentName);
    } else {
      const contents = fs.readFileSync(sourcePath, "utf8");
      fs.writeFileSync(targetPath, contents.replaceAll("{{AGENT_NAME}}", agentName), "utf8");
    }
  }
}

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .argument("<name>", "agent name (also the directory name)")
    .description("Scaffold a new agent: kohala.json, a working skill, and the local SDK")
    .action((name: string) => {
      const nameCheck = manifestSchema.shape.name.safeParse(name);
      if (!nameCheck.success) {
        throw new Error(
          `"${name}" is not a valid agent name: ${nameCheck.error.issues[0]?.message ?? "invalid"}`,
        );
      }
      const targetDir = path.resolve(process.cwd(), name);
      if (fs.existsSync(targetDir)) {
        throw new Error(`${targetDir} already exists — pick a new name or remove the directory.`);
      }
      copyTemplates(templatesDir(), targetDir, name);
      console.log(pc.green(`Created agent "${name}" in ${targetDir}`));
      console.log("");
      console.log("Next steps:");
      console.log(pc.cyan(`  kohala validate ${name}`));
      console.log(pc.cyan(`  kohala run ${name} --local`));
      console.log(pc.cyan(`  kohala trace ${name}`));
    });
}
