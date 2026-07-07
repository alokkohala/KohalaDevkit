import http from "node:http";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { DEFAULT_CATEGORY, type MemoryStore } from "../memory/store.js";

/**
 * The open MCP memory server — `kohala memory serve`.
 *
 * Exposes the platform's four memory tools over the Model Context Protocol
 * with identical names and semantics (A.1), so an agent using this server
 * locally needs zero changes when it goes live:
 *
 *   s3.put / s3.get / s3.list / s3.delete
 *
 * Also exposes a `memory://index` resource that lists all active assets.
 * Supported transports: stdio (default, for MCP clients that spawn a child
 * process) and streamable HTTP (for MCP Inspector and remote-style clients).
 */

/** Server identity advertised over MCP. */
const SERVER_INFO = { name: "kohala-memory", version: "0.1.0" };

/** Build a configured MCP server bound to one agent's MemoryStore. */
export function buildMemoryMcpServer(store: MemoryStore, agent: string): McpServer {
  const server = new McpServer(SERVER_INFO);

  server.registerTool(
    "s3.put",
    {
      title: "Store memory asset",
      description:
        `Store a value in ${agent}'s persistent memory under a logical key. ` +
        `Category defaults to "${DEFAULT_CATEGORY}" (run results).`,
      inputSchema: {
        key: z.string().min(1).describe("Logical key, e.g. weather/latest"),
        body: z.string().describe("UTF-8 body to store"),
        category: z.string().optional().describe(`Asset category (default "${DEFAULT_CATEGORY}")`),
      },
    },
    async ({ key, body, category }) => {
      const record = await store.put(key, Buffer.from(body, "utf8"), category);
      return { content: [{ type: "text", text: JSON.stringify({ record }, null, 2) }] };
    },
  );

  server.registerTool(
    "s3.get",
    {
      title: "Fetch memory asset",
      description: "Fetch an asset by logical key (resolved first) or record id.",
      inputSchema: {
        keyOrId: z.string().min(1).describe("Logical key or record id"),
      },
    },
    async ({ keyOrId }) => {
      const asset = await store.get(keyOrId);
      if (!asset) {
        return {
          isError: true,
          content: [{ type: "text", text: `No active memory asset matches "${keyOrId}"` }],
        };
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { record: asset.record, body: asset.body.toString("utf8") },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    "s3.list",
    {
      title: "List memory assets",
      description: "List active assets for the agent, newest first, optionally by key prefix.",
      inputSchema: {
        prefix: z.string().optional().describe("Only keys starting with this prefix"),
        limit: z.number().int().positive().optional().describe("Max records (default 100)"),
      },
    },
    async ({ prefix, limit }) => {
      const records = await store.list(prefix, limit);
      return { content: [{ type: "text", text: JSON.stringify({ records }, null, 2) }] };
    },
  );

  server.registerTool(
    "s3.delete",
    {
      title: "Delete memory asset",
      description: "Remove an asset's body and deactivate its index entry (soft delete).",
      inputSchema: {
        keyOrId: z.string().min(1).describe("Logical key or record id"),
      },
    },
    async ({ keyOrId }) => {
      const record = await store.delete(keyOrId);
      if (!record) {
        return {
          isError: true,
          content: [{ type: "text", text: `No active memory asset matches "${keyOrId}"` }],
        };
      }
      return { content: [{ type: "text", text: JSON.stringify({ record }, null, 2) }] };
    },
  );

  // memory://index — a browsable listing of every active asset.
  server.registerResource(
    "memory-index",
    "memory://index",
    {
      title: `Memory index for ${agent}`,
      description: "All active memory assets for this agent (key, category, timestamps).",
      mimeType: "application/json",
    },
    async (uri) => {
      const records = await store.list(undefined, 1000);
      return {
        contents: [
          { uri: uri.href, mimeType: "application/json", text: JSON.stringify({ agent, records }, null, 2) },
        ],
      };
    },
  );

  return server;
}

/** Serve over stdio — the default transport for `kohala memory serve`. */
export async function serveStdio(store: MemoryStore, agent: string): Promise<void> {
  const server = buildMemoryMcpServer(store, agent);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/**
 * Serve over streamable HTTP on 127.0.0.1:<port> at /mcp.
 *
 * Runs in stateless mode: each request gets a fresh server + transport pair,
 * which keeps the implementation simple and is exactly what MCP Inspector and
 * one-shot clients expect. Returns the http.Server for lifecycle control.
 */
export async function serveHttp(
  store: MemoryStore,
  agent: string,
  port: number,
): Promise<http.Server> {
  const httpServer = http.createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname !== "/mcp") {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: "Not found. The MCP endpoint is POST /mcp" }));
        return;
      }
      if (request.method !== "POST") {
        response.writeHead(405, { "content-type": "application/json" });
        response.end(
          JSON.stringify({ error: "Stateless MCP server: only POST /mcp is supported" }),
        );
        return;
      }
      let raw = "";
      request.on("data", (chunk) => {
        raw += chunk;
      });
      request.on("end", () => {
        void (async () => {
          let body: unknown;
          try {
            body = JSON.parse(raw);
          } catch {
            response.writeHead(400, { "content-type": "application/json" });
            response.end(JSON.stringify({ error: "Request body is not valid JSON" }));
            return;
          }
          const server = buildMemoryMcpServer(store, agent);
          const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined, // stateless
          });
          response.on("close", () => {
            void transport.close();
            void server.close();
          });
          await server.connect(transport);
          await transport.handleRequest(request, response, body);
        })();
      });
    })();
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(port, "127.0.0.1", resolve);
  });
  return httpServer;
}
