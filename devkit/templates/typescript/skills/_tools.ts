export class ToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "ToolError";
  }
}

interface RpcSuccess<T> {
  ok: true;
  result: T;
}

interface RpcFailure {
  ok: false;
  error?: { code?: string; message?: string };
}

export type ToolPayload = Record<string, unknown>;

export interface ToolEnvelope<T = unknown> {
  ok: boolean;
  output?: T;
  error?: string;
  summary?: string;
}

export async function callToolRaw<T = unknown>(
  toolId: string,
  payload: ToolPayload,
  _timeoutMs?: number,
): Promise<ToolEnvelope<T>> {
  const rpcUrl = process.env.KOHALA_RPC_URL;
  if (!rpcUrl) {
    throw new ToolError(
      "NO_RUNTIME",
      "KOHALA_RPC_URL is not set. Run via `kohala run <agent> --local`.",
    );
  }
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tool: toolId, args: payload }),
  });
  const body = (await response.json()) as RpcSuccess<T> | RpcFailure;
  if (!body.ok) {
    return {
      ok: false,
      error: `${body.error?.code ?? "UNKNOWN"}: ${body.error?.message ?? "tool call failed"}`,
    };
  }
  return { ok: true, output: body.result };
}

export async function callTool<T = unknown>(
  toolId: string,
  payload: ToolPayload,
  timeoutMs?: number,
): Promise<T> {
  const result = await callToolRaw<T>(toolId, payload, timeoutMs);
  if (!result.ok) {
    throw new ToolError("TOOL_ERROR", result.error ?? `${toolId}: tool returned ok=false`);
  }
  return result.output as T;
}

type ToolFunction<T = unknown> = (payload: ToolPayload, timeoutMs?: number) => Promise<T>;

export interface KohalaTools {
  [toolId: string]: ToolFunction;
  s3Put: ToolFunction;
  s3Get: ToolFunction;
  s3List: ToolFunction<MemoryList>;
  s3Delete: ToolFunction;
  httpPostJson: ToolFunction;
  llmComplete: ToolFunction<string>;
  notifySend: ToolFunction;
  metricsRecord: ToolFunction;
}

export const tools = new Proxy({} as KohalaTools, {
  get: (_target, property) => {
    const toolId = String(property).replace(/[A-Z]/g, (letter) => `.${letter.toLowerCase()}`);
    return (payload: ToolPayload, timeoutMs?: number) => callTool(toolId, payload, timeoutMs);
  },
});

export function configure(): never {
  throw new ToolError(
    "UNSUPPORTED",
    "configure() is managed by the Kohala runtime and is unavailable locally.",
  );
}

export const TOOL_IDS = [
  "s3.put",
  "s3.get",
  "s3.list",
  "s3.delete",
  "http.post_json",
  "llm.complete",
  "notify.send",
  "metrics.record",
] as const;

export function camel(id: string): string {
  return id.replace(/[._-]+(.)/g, (_match, letter: string) => letter.toUpperCase());
}

export interface MemoryRecord {
  id: string;
  key: string;
  [key: string]: unknown;
}

export interface MemoryList {
  records: MemoryRecord[];
  [key: string]: unknown;
}
