import dns from "node:dns/promises";
import net from "node:net";
import { assertToolAllowed, ToolDeniedError } from "../emulator/allowlist.js";
import { CapExceededError, estimateTokens, type TokenMeter } from "../emulator/tokens.js";
import { completeText } from "../emulator/llm-client.js";
import type { AgentManifest } from "../manifest/schema.js";
import type { MemoryStore } from "../memory/store.js";
import type { TraceWriter } from "../trace/writer.js";

/** Everything the dispatcher needs to execute tools for one shift. */
export interface DispatchContext {
  manifest: AgentManifest;
  store: MemoryStore;
  trace: TraceWriter;
  meter: TokenMeter;
  runId: string;
}

/** Structured tool error carried back to the caller (script or LLM loop). */
export interface ToolErrorShape {
  code: string;
  message: string;
}

/** Thrown by dispatch when a tool fails; carries a machine-readable code. */
export class ToolCallError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ToolCallError";
  }
}

/** Truncated, non-sensitive one-line summary of tool args for the trace. */
export function summarizeArgs(args: unknown): string {
  const json = JSON.stringify(args) ?? "{}";
  return json.length > 200 ? `${json.slice(0, 200)}…` : json;
}

/**
 * SSRF guard for http.post_json — the same guard the platform applies.
 *
 * Checks the hostname pattern AND every IP the hostname resolves to (so a
 * public DNS name pointing at an internal address is still refused), for
 * both IPv4 and IPv6. Redirects are followed manually with each hop
 * re-validated.
 */
function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (lower === "localhost" || lower.endsWith(".localhost")) return true;
  if (net.isIP(lower)) return isBlockedIp(lower);
  return false;
}

function isBlockedIp(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) {
    const octets = ip.split(".").map(Number);
    const [a = 0, b = 0] = octets;
    if (a === 0 || a === 10 || a === 127) return true; // this-net, private, loopback
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  if (version === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::" || lower === "::1") return true; // unspecified, loopback
    if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb"))
      return true; // link-local fe80::/10
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA fc00::/7
    if (lower.startsWith("::ffff:")) {
      // IPv4-mapped — validate the embedded IPv4 address.
      const mapped = lower.slice("::ffff:".length);
      return net.isIP(mapped) === 4 ? isBlockedIp(mapped) : true;
    }
    return false;
  }
  return true; // not a valid IP at all — refuse
}

/** Throw BLOCKED_HOST unless the hostname and all its resolved IPs are public. */
async function assertPublicHost(hostname: string): Promise<void> {
  if (isBlockedHostname(hostname)) {
    throw new ToolCallError(
      "BLOCKED_HOST",
      `http.post_json refuses internal/private hosts ("${hostname}") — same guard the platform applies.`,
    );
  }
  const bare = hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(bare)) return; // literal IP already validated above
  let addresses: { address: string }[];
  try {
    addresses = await dns.lookup(bare, { all: true, verbatim: true });
  } catch {
    throw new ToolCallError("BAD_URL", `http.post_json could not resolve host "${hostname}"`);
  }
  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      throw new ToolCallError(
        "BLOCKED_HOST",
        `http.post_json refuses "${hostname}" — it resolves to the internal/private address ${address}.`,
      );
    }
  }
}

/** Max redirect hops http.post_json will follow (each hop is re-validated). */
const MAX_REDIRECTS = 3;

/**
 * Executes one tool call with the full platform semantics:
 * allowlist check -> execution -> trace `tool_call` event (allow/deny,
 * duration). Used by both the loopback RPC server (wrap mode) and the
 * llm-mode tool-use loop, so enforcement is identical in both paths.
 */
export class ToolDispatcher {
  constructor(private readonly context: DispatchContext) {}

  /** All tools the emulator knows how to execute. */
  static readonly KNOWN_TOOLS = [
    "s3.put",
    "s3.get",
    "s3.list",
    "s3.delete",
    "http.post_json",
    "llm.complete",
    "notify.send",
    "metrics.record",
  ] as const;

  /**
   * Execute `tool` with `args`. Always writes a tool_call trace event, whether
   * the call was allowed, denied, or failed.
   */
  async call(tool: string, args: Record<string, unknown>): Promise<unknown> {
    const { manifest, trace, runId } = this.context;
    const startedAt = Date.now();
    const base = {
      ts: new Date().toISOString(),
      runId,
      agent: manifest.name,
      type: "tool_call" as const,
      tool,
      argsSummary: summarizeArgs(args),
    };

    // 1. Allowlist — every tool call is checked; disallowed calls fail loudly.
    try {
      assertToolAllowed(manifest.toolAllowlist, tool);
    } catch (error) {
      trace.append({
        ...base,
        allowed: false,
        ok: false,
        durationMs: Date.now() - startedAt,
        error: (error as Error).message,
      });
      throw new ToolCallError("TOOL_DENIED", (error as ToolDeniedError).message);
    }

    // 2. Execute.
    try {
      const result = await this.execute(tool, args);
      trace.append({ ...base, allowed: true, ok: true, durationMs: Date.now() - startedAt });
      return result;
    } catch (error) {
      const message = (error as Error).message;
      trace.append({
        ...base,
        allowed: true,
        ok: false,
        durationMs: Date.now() - startedAt,
        error: message,
      });
      if (error instanceof ToolCallError) throw error;
      if (error instanceof CapExceededError) throw new ToolCallError(error.code, message);
      throw new ToolCallError("TOOL_ERROR", message);
    }
  }

  private async execute(tool: string, args: Record<string, unknown>): Promise<unknown> {
    const { store, meter, trace, manifest, runId } = this.context;
    switch (tool) {
      case "s3.put": {
        const key = requireString(args, "key");
        const body = requireString(args, "body");
        const category = optionalString(args, "category");
        const record = await store.put(key, Buffer.from(body, "utf8"), category);
        return { record };
      }
      case "s3.get": {
        const keyOrId = requireString(args, "keyOrId");
        const asset = await store.get(keyOrId);
        if (!asset) {
          throw new ToolCallError("NOT_FOUND", `No active memory asset matches "${keyOrId}"`);
        }
        return { record: asset.record, body: asset.body.toString("utf8") };
      }
      case "s3.list": {
        const prefix = optionalString(args, "prefix");
        const limit = typeof args.limit === "number" ? args.limit : undefined;
        const records = await store.list(prefix, limit);
        return { records };
      }
      case "s3.delete": {
        const keyOrId = requireString(args, "keyOrId");
        const record = await store.delete(keyOrId);
        if (!record) {
          throw new ToolCallError("NOT_FOUND", `No active memory asset matches "${keyOrId}"`);
        }
        return { record };
      }
      case "http.post_json": {
        const url = requireString(args, "url");
        const headers = (args.headers ?? {}) as Record<string, string>;
        const requestBody = JSON.stringify(args.body ?? {});

        // Redirects are followed manually so every hop goes through the same
        // SSRF guard — a public URL redirecting to an internal address is
        // refused just like a direct request to it would be.
        let currentUrl = url;
        let response: Response;
        for (let hop = 0; ; hop += 1) {
          const parsed = safeParseUrl(currentUrl);
          if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
            throw new ToolCallError(
              "BAD_URL",
              `http.post_json needs an http(s) URL, got "${currentUrl}"`,
            );
          }
          await assertPublicHost(parsed.hostname);
          response = await fetch(currentUrl, {
            method: "POST",
            headers: { "content-type": "application/json", ...headers },
            body: requestBody,
            redirect: "manual",
          });
          if (response.status < 300 || response.status >= 400) break;
          const location = response.headers.get("location");
          if (!location) break;
          if (hop >= MAX_REDIRECTS) {
            throw new ToolCallError(
              "TOO_MANY_REDIRECTS",
              `http.post_json gave up after ${MAX_REDIRECTS} redirects (last: ${currentUrl})`,
            );
          }
          currentUrl = new URL(location, currentUrl).toString();
        }

        const text = await response.text();
        let json: unknown = null;
        try {
          json = JSON.parse(text);
        } catch {
          // Non-JSON responses come back as text only; that is not an error.
        }
        return { status: response.status, ok: response.ok, body: text, json };
      }
      case "llm.complete": {
        const prompt = requireString(args, "prompt");
        const model = optionalString(args, "model");
        // Pre-turn projection against the per-run cap (A.2 step 3): prompt
        // estimate + the max output we allow for one completion.
        const maxOutput = 1024;
        meter.admitLlmTurn(estimateTokens(prompt) + maxOutput);
        const completion = await completeText(prompt, model, maxOutput);
        const consumed = completion.inputTokens + completion.outputTokens;
        const dayTotal = meter.add(consumed);
        trace.append({
          ts: new Date().toISOString(),
          runId,
          agent: manifest.name,
          type: "tokens",
          tokens: consumed,
          runTotal: meter.runTotal,
          dayTotal,
          source: `llm.complete ${completion.provider}/${completion.model}`,
        });
        return {
          text: completion.text,
          model: completion.model,
          provider: completion.provider,
          inputTokens: completion.inputTokens,
          outputTokens: completion.outputTokens,
        };
      }
      case "notify.send": {
        // Locally, notifications just land in the trace (the tool_call event
        // records channel + message via argsSummary). Nothing is sent anywhere.
        requireString(args, "channel");
        requireString(args, "message");
        return { delivered: "trace" };
      }
      case "metrics.record": {
        // Locally, metrics are appended to the trace via the tool_call event.
        requireString(args, "name");
        if (typeof args.value !== "number") {
          throw new ToolCallError("BAD_ARGS", "metrics.record needs a numeric value");
        }
        return { recorded: "trace" };
      }
      default:
        throw new ToolCallError(
          "UNKNOWN_TOOL",
          `Unknown tool "${tool}". Known tools: ${ToolDispatcher.KNOWN_TOOLS.join(", ")}`,
        );
    }
  }
}

function requireString(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new ToolCallError("BAD_ARGS", `Missing required string argument "${name}"`);
  }
  return value;
}

function optionalString(args: Record<string, unknown>, name: string): string | undefined {
  const value = args[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new ToolCallError("BAD_ARGS", `Argument "${name}" must be a string when provided`);
  }
  return value;
}

function safeParseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}
