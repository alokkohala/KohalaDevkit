import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import pc from "picocolors";
import { followTraceFile, readTraceFile } from "../trace/reader.js";
import { formatTraceEvent } from "../trace/format.js";
import { traceFilePath } from "../trace/writer.js";
import { loadManifest } from "../manifest/load.js";

/**
 * `kohala trace <agent>` — pretty-print (and optionally follow) the agent's
 * JSONL audit trace, the local twin of the platform's run records.
 */
export function registerTraceCommand(program: Command): void {
  program
    .command("trace")
    .argument("<agent>", "agent directory or agent name")
    .option("--follow", "keep watching for new events (like tail -f)")
    .option("--json", "print raw JSONL events instead of the pretty view")
    .description("Tail the audit trace for an agent")
    .action((agent: string, options: { follow?: boolean; json?: boolean }) => {
      const rootDir = process.cwd();
      // Accept either a directory (read its manifest for the name) or a bare name.
      let agentName = agent;
      const agentDir = path.resolve(rootDir, agent);
      if (fs.existsSync(path.join(agentDir, "kohala.json"))) {
        agentName = loadManifest(agentDir).name;
      }
      const filePath = traceFilePath(rootDir, agentName);
      if (!fs.existsSync(filePath)) {
        throw new Error(
          `No trace found for "${agentName}" (looked at ${filePath}). Run the agent first: kohala run ${agent} --local`,
        );
      }

      const print = options.json
        ? (event: object) => console.log(JSON.stringify(event))
        : (event: object) => console.log(formatTraceEvent(event as Parameters<typeof formatTraceEvent>[0]));

      for (const event of readTraceFile(filePath)) {
        print(event);
      }

      if (options.follow) {
        console.error(pc.dim(`— following ${filePath} (ctrl-c to stop) —`));
        followTraceFile(filePath, print);
      }
    });
}
