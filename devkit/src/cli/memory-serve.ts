import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import pc from "picocolors";
import { createMemoryStore, type MemoryBackend } from "../memory/create.js";
import { serveHttp, serveStdio } from "../mcp/server.js";
import { loadManifest } from "../manifest/load.js";

/**
 * `kohala memory serve` — run the open MCP memory server.
 *
 * Transports:
 *   default   — stdio, for MCP clients that spawn a child process
 *   --http    — streamable HTTP on 127.0.0.1:<port>/mcp (MCP Inspector etc.)
 *
 * Backends: file (default, .kohala/memory/<agent>/) or postgres (--url or
 * DATABASE_URL). Memory is always scoped to one agent, like the platform.
 */
export function registerMemoryCommand(program: Command): void {
  const memory = program.command("memory").description("Memory server commands");

  memory
    .command("serve")
    .option("--agent <name>", "agent name to scope memory to (or run from an agent dir)")
    .option("--backend <backend>", "file | postgres", "file")
    .option("--url <url>", "postgres connection string (or set DATABASE_URL)")
    .option("--http", "serve over streamable HTTP instead of stdio")
    .option("--port <port>", "HTTP port (with --http)", "8787")
    .description("Serve agent memory over the Model Context Protocol")
    .action(
      async (options: {
        agent?: string;
        backend: string;
        url?: string;
        http?: boolean;
        port: string;
      }) => {
        if (options.backend !== "file" && options.backend !== "postgres") {
          throw new Error(`Unknown backend "${options.backend}" — use "file" or "postgres".`);
        }

        // Agent resolution: explicit --agent wins; otherwise, if the current
        // directory is an agent dir (has kohala.json), use its name.
        let agent = options.agent;
        let rootDir = process.cwd();
        if (!agent) {
          const manifestHere = path.join(process.cwd(), "kohala.json");
          if (fs.existsSync(manifestHere)) {
            agent = loadManifest(process.cwd()).name;
            // Memory for an agent dir lives in the parent workspace root.
            rootDir = path.dirname(process.cwd());
          } else {
            throw new Error(
              "Pass --agent <name>, or run this from inside an agent directory (one containing kohala.json).",
            );
          }
        }

        const store = await createMemoryStore({
          backend: options.backend as MemoryBackend,
          agent,
          rootDir,
          url: options.url ?? process.env.DATABASE_URL,
        });

        if (options.http) {
          const port = Number(options.port);
          await serveHttp(store, agent, port);
          // Log to stderr so stdout stays clean for any piping.
          console.error(
            pc.green(`MCP memory server for "${agent}" listening on http://127.0.0.1:${port}/mcp`),
          );
          console.error(pc.dim(`backend=${options.backend} — ctrl-c to stop`));
        } else {
          console.error(
            pc.dim(`MCP memory server for "${agent}" on stdio (backend=${options.backend})`),
          );
          await serveStdio(store, agent);
        }
      },
    );
}
