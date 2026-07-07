import http from "node:http";
import { ToolCallError, ToolDispatcher, type DispatchContext } from "./dispatch.js";

/**
 * Loopback HTTP RPC server — the script <-> runtime boundary.
 *
 * Scaffolded Python scripts talk to the emulator over this loopback endpoint
 * (the same pattern the platform uses), NOT by importing emulator internals.
 * That keeps a locally-written script byte-identical when deployed: only the
 * KOHALA_RPC_URL environment variable changes.
 *
 * Protocol: POST / with JSON `{"tool": "s3.put", "args": {...}}`.
 * Success:  200 `{"ok": true, "result": ...}`
 * Failure:  200 `{"ok": false, "error": {"code": "...", "message": "..."}}`
 * (Tool failures are application-level, not transport-level, so the Python
 * SDK can raise a typed KohalaToolError with the platform's error codes.)
 */

/** A running RPC server bound to 127.0.0.1 on an ephemeral port. */
export interface SdkRpcServer {
  /** Base URL, e.g. "http://127.0.0.1:53412" — passed to scripts as KOHALA_RPC_URL. */
  url: string;
  close(): Promise<void>;
}

/** Start the loopback RPC server for one shift. */
export async function startSdkRpcServer(context: DispatchContext): Promise<SdkRpcServer> {
  const dispatcher = new ToolDispatcher(context);

  const server = http.createServer((request, response) => {
    if (request.method !== "POST") {
      response.writeHead(405, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: false, error: { code: "METHOD_NOT_ALLOWED", message: "POST only" } }));
      return;
    }
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => {
      void (async () => {
        let payload: { tool?: unknown; args?: unknown };
        try {
          payload = JSON.parse(raw) as { tool?: unknown; args?: unknown };
        } catch {
          respond(response, { ok: false, error: { code: "BAD_JSON", message: "Request body is not valid JSON" } });
          return;
        }
        if (typeof payload.tool !== "string") {
          respond(response, { ok: false, error: { code: "BAD_REQUEST", message: 'Missing "tool" field' } });
          return;
        }
        try {
          const result = await dispatcher.call(
            payload.tool,
            (payload.args ?? {}) as Record<string, unknown>,
          );
          respond(response, { ok: true, result });
        } catch (error) {
          if (error instanceof ToolCallError) {
            respond(response, { ok: false, error: { code: error.code, message: error.message } });
            return;
          }
          respond(response, {
            ok: false,
            error: { code: "INTERNAL", message: (error as Error).message },
          });
        }
      })();
    });
  });

  await new Promise<void>((resolve) => {
    // Bind to loopback only — the RPC surface must never be reachable off-host.
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Could not determine RPC server port");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function respond(response: http.ServerResponse, body: unknown): void {
  const json = JSON.stringify(body);
  response.writeHead(200, { "content-type": "application/json" });
  response.end(json);
}
