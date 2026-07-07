import { createRequire } from "node:module";
import { Command } from "commander";
import pc from "picocolors";
import { registerInitCommand } from "./init.js";
import { registerValidateCommand } from "./validate.js";
import { registerRunCommand } from "./run.js";
import { registerTraceCommand } from "./trace.js";
import { registerMemoryCommand } from "./memory-serve.js";
import { registerLoginCommand } from "./login.js";
import { registerDeployCommand } from "./deploy.js";
import { registerDoctorCommand } from "./doctor.js";

/**
 * The `kohala` CLI entry point.
 *
 * Command files under src/cli/ are deliberately thin: they parse flags, call
 * into lib code (manifest/, emulator/, memory/, deploy/), and format output.
 * All behavior lives in the libraries so it is unit-testable without a TTY.
 */

const require = createRequire(import.meta.url);
// Version comes straight from package.json so `kohala --version` can never drift.
const { version } = require("../../package.json") as { version: string };

const program = new Command();

program
  .name("kohala")
  .description(
    "Kohala Devkit — build and run agents entirely on your own machine, then push the same agent to Kohala when you want it hosted.",
  )
  .version(version);

registerInitCommand(program);
registerValidateCommand(program);
registerRunCommand(program);
registerTraceCommand(program);
registerMemoryCommand(program);
registerLoginCommand(program);
registerDeployCommand(program);
registerDoctorCommand(program);

program.parseAsync(process.argv).catch((error: Error) => {
  // Central failure path: every command failure lands here, loudly and red.
  console.error(pc.red(`\n${error.message}`));
  process.exitCode = 1;
});
