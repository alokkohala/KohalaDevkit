import readline from "node:readline";
import type { Command } from "commander";
import pc from "picocolors";
import { saveApiKey } from "../deploy/credentials.js";

/**
 * `kohala login` — save a pk_ API key to ~/.kohala/credentials.json (0600).
 * The KOHALA_API_KEY environment variable always takes precedence over the
 * saved key, which is the right default for CI.
 */
export function registerLoginCommand(program: Command): void {
  program
    .command("login")
    .option("--api-key <key>", "provide the key non-interactively")
    .description("Save your Kohala API key for `kohala deploy`")
    .action(async (options: { apiKey?: string }) => {
      let apiKey = options.apiKey;
      if (!apiKey) {
        apiKey = await promptHidden(
          "Paste your Kohala API key (starts with pk_, from kohala.ai account settings): ",
        );
      }
      if (!apiKey) {
        throw new Error("No API key provided.");
      }
      const savedTo = saveApiKey(apiKey.trim());
      console.log(pc.green(`API key saved to ${savedTo} (permissions 600).`));
      console.log(pc.dim("Note: the KOHALA_API_KEY environment variable overrides this file."));
    });
}

/** Prompt without echoing the key back to the terminal. */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
    const stdin = process.stdin as NodeJS.ReadStream & { setRawMode?: (mode: boolean) => void };
    process.stderr.write(question);
    if (stdin.isTTY && stdin.setRawMode) {
      stdin.setRawMode(true);
      let value = "";
      const onData = (chunk: Buffer) => {
        const char = chunk.toString("utf8");
        if (char === "\n" || char === "\r" || char === "\u0004") {
          stdin.setRawMode?.(false);
          stdin.off("data", onData);
          rl.close();
          process.stderr.write("\n");
          resolve(value);
        } else if (char === "\u0003") {
          // ctrl-c
          stdin.setRawMode?.(false);
          rl.close();
          process.exit(130);
        } else if (char === "\u007f") {
          value = value.slice(0, -1);
        } else {
          value += char;
        }
      };
      stdin.on("data", onData);
    } else {
      rl.question("", (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}
