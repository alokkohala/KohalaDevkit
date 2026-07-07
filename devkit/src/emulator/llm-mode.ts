import fs from "node:fs";
import { estimateTokens } from "./tokens.js";
import { ToolCallError, ToolDispatcher, type DispatchContext } from "../sdk/dispatch.js";
import { NoLlmKeyError } from "./llm-client.js";

/**
 * llm runtime mode — a real tool-use loop against the developer's own
 * Anthropic key (Anthropic first, per the build plan; Gemini support for
 * llm-mode can follow).
 *
 * The allowlisted tools are exposed to the model as tool definitions; every
 * tool invocation goes through the same ToolDispatcher as wrap mode, so
 * allowlist checks, tracing, and token accounting are identical. Before each
 * turn we project the next request's token cost against caps.perRunTokens and
 * abort with PER_RUN_TOKEN_CAP if it would cross (A.2 step 3).
 */

/** Max loop turns as a hard safety stop, independent of token caps. */
const MAX_TURNS = 16;

/** Per-turn output ceiling passed to the API. */
const MAX_OUTPUT_TOKENS = 1024;

/** JSON Schema definitions for each platform tool, keyed by tool name. */
const TOOL_DEFINITIONS: Record<string, { description: string; input_schema: object }> = {
  "s3.put": {
    description:
      'Store a value in agent memory under a logical key. Category defaults to "agentoutput".',
    input_schema: {
      type: "object",
      properties: {
        key: { type: "string" },
        body: { type: "string" },
        category: { type: "string" },
      },
      required: ["key", "body"],
    },
  },
  "s3.get": {
    description: "Fetch a memory asset by logical key (or record id).",
    input_schema: {
      type: "object",
      properties: { keyOrId: { type: "string" } },
      required: ["keyOrId"],
    },
  },
  "s3.list": {
    description: "List active memory assets, optionally filtered by key prefix.",
    input_schema: {
      type: "object",
      properties: { prefix: { type: "string" }, limit: { type: "number" } },
    },
  },
  "s3.delete": {
    description: "Remove and deactivate a memory asset by key or id.",
    input_schema: {
      type: "object",
      properties: { keyOrId: { type: "string" } },
      required: ["keyOrId"],
    },
  },
  "http.post_json": {
    description: "POST a JSON body to an external http(s) URL and return the response.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string" },
        body: { type: "object" },
        headers: { type: "object" },
      },
      required: ["url"],
    },
  },
  "notify.send": {
    description: "Send a notification (locally this is recorded in the audit trace).",
    input_schema: {
      type: "object",
      properties: { channel: { type: "string" }, message: { type: "string" } },
      required: ["channel", "message"],
    },
  },
  "metrics.record": {
    description: "Record a metric point (locally this is recorded in the audit trace).",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        value: { type: "number" },
        tags: { type: "object" },
      },
      required: ["name", "value"],
    },
  },
};

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
}

interface AnthropicResponse {
  content: AnthropicContentBlock[];
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
}

/**
 * Run one llm-mode shift. Returns the model's final text output.
 *
 * The skill script file, if present, contributes its contents as task context
 * (llm-mode agents describe their task in the skill file; the charter is the
 * system prompt) — this mirrors how the platform prompts hosted llm agents.
 */
export async function runLlmShift(
  context: DispatchContext,
  skillName: string,
  scriptPath: string,
  repairFeedback?: string,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new NoLlmKeyError();
  }
  const model = process.env.KOHALA_LLM_MODEL ?? "claude-3-5-haiku-latest";
  const dispatcher = new ToolDispatcher(context);
  const { manifest, meter, trace, runId } = context;

  // Only allowlisted tools are exposed as definitions — the model cannot even
  // see tools it is not allowed to call.
  const tools = Object.entries(TOOL_DEFINITIONS)
    .filter(([name]) => manifest.toolAllowlist.includes(name))
    .map(([name, definition]) => ({ name: toApiToolName(name), ...definition }));

  const taskContext = fs.existsSync(scriptPath) ? fs.readFileSync(scriptPath, "utf8") : "";
  const messages: { role: "user" | "assistant"; content: unknown }[] = [
    {
      role: "user",
      content:
        `You are running one shift of the agent skill "${skillName}".\n` +
        (taskContext ? `Task instructions:\n${taskContext}\n` : "") +
        (repairFeedback
          ? `\nThis is a repair attempt. Your previous output failed validation:\n${repairFeedback}\nFix the problem this time.\n`
          : "") +
        "Use your tools as needed, then reply with a final text summary of what you did.",
    },
  ];

  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    // Pre-turn projection (A.2 step 3): estimate the request we are about to
    // send plus the response ceiling, and abort before crossing the cap.
    const projected = estimateTokens(JSON.stringify(messages) + manifest.charter) + MAX_OUTPUT_TOKENS;
    meter.admitLlmTurn(projected);

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: manifest.charter,
        tools,
        messages,
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${body.slice(0, 300)}`);
    }
    const data = (await response.json()) as AnthropicResponse;

    const consumed = data.usage.input_tokens + data.usage.output_tokens;
    const dayTotal = meter.add(consumed);
    trace.append({
      ts: new Date().toISOString(),
      runId,
      agent: manifest.name,
      type: "tokens",
      tokens: consumed,
      runTotal: meter.runTotal,
      dayTotal,
      source: `llm-mode turn ${turn + 1} (${model})`,
    });

    const finalText = data.content
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("");

    if (data.stop_reason !== "tool_use") {
      return finalText;
    }

    // Execute each requested tool through the shared dispatcher, then feed
    // results (or loud errors) back to the model.
    messages.push({ role: "assistant", content: data.content });
    const toolResults: AnthropicContentBlock[] = [];
    for (const block of data.content) {
      if (block.type !== "tool_use" || !block.id || !block.name) continue;
      const toolName = fromApiToolName(block.name);
      try {
        const result = await dispatcher.call(toolName, block.input ?? {});
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: JSON.stringify(result).slice(0, 8000),
        });
      } catch (error) {
        const toolError = error as ToolCallError;
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `${toolError.code ?? "TOOL_ERROR"}: ${toolError.message}`,
          is_error: true,
        });
      }
    }
    messages.push({ role: "user", content: toolResults });
  }

  throw new Error(`llm-mode shift exceeded ${MAX_TURNS} turns without finishing`);
}

/**
 * Anthropic tool names must match [a-zA-Z0-9_-], so the platform's dotted
 * names are transported with "__" in place of "." and mapped back on dispatch.
 */
function toApiToolName(name: string): string {
  return name.replace(/\./g, "__");
}

function fromApiToolName(name: string): string {
  return name.replace(/__/g, ".");
}
