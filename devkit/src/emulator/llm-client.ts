/**
 * Thin LLM client used by `llm.complete` (wrap mode) and the llm-mode loop.
 *
 * Uses the developer's OWN key from the environment — ANTHROPIC_API_KEY first,
 * then GEMINI_API_KEY. If neither is set the call fails with a clear
 * "no key configured" error. There is deliberately no mock fallback: silent
 * fake completions would hide real integration problems (Part B: errors fail
 * loudly).
 */

/** Result of a single completion, with token usage for cap accounting. */
export interface CompletionResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  provider: "anthropic" | "gemini";
  model: string;
}

/** Thrown when no LLM API key is configured in the environment. */
export class NoLlmKeyError extends Error {
  constructor() {
    super(
      "NO_LLM_KEY: no LLM key configured. Set ANTHROPIC_API_KEY (preferred) or " +
        "GEMINI_API_KEY in your environment — the devkit never mocks completions.",
    );
    this.name = "NoLlmKeyError";
  }
}

/** Default models per provider — overridable per call via `model`. */
const DEFAULT_ANTHROPIC_MODEL = "claude-3-5-haiku-latest";
const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash";

/** Which provider will handle completions given the current environment. */
export function detectLlmProvider(
  env: NodeJS.ProcessEnv = process.env,
): "anthropic" | "gemini" | null {
  if (env.ANTHROPIC_API_KEY) return "anthropic";
  if (env.GEMINI_API_KEY) return "gemini";
  return null;
}

/**
 * Complete a prompt with the developer's own key.
 *
 * @param prompt - The user prompt to complete.
 * @param model - Optional model override (provider-native model name).
 * @param maxOutputTokens - Ceiling passed to the provider (defaults to 1024).
 */
export async function completeText(
  prompt: string,
  model?: string,
  maxOutputTokens = 1024,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CompletionResult> {
  const provider = detectLlmProvider(env);
  if (provider === "anthropic") {
    return completeAnthropic(prompt, model ?? DEFAULT_ANTHROPIC_MODEL, maxOutputTokens, env);
  }
  if (provider === "gemini") {
    return completeGemini(prompt, model ?? DEFAULT_GEMINI_MODEL, maxOutputTokens, env);
  }
  throw new NoLlmKeyError();
}

async function completeAnthropic(
  prompt: string,
  model: string,
  maxOutputTokens: number,
  env: NodeJS.ProcessEnv,
): Promise<CompletionResult> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY as string,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxOutputTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${body.slice(0, 300)}`);
  }
  const data = (await response.json()) as {
    content: { type: string; text?: string }[];
    usage: { input_tokens: number; output_tokens: number };
  };
  const text = data.content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("");
  return {
    text,
    inputTokens: data.usage.input_tokens,
    outputTokens: data.usage.output_tokens,
    provider: "anthropic",
    model,
  };
}

async function completeGemini(
  prompt: string,
  model: string,
  maxOutputTokens: number,
  env: NodeJS.ProcessEnv,
): Promise<CompletionResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": env.GEMINI_API_KEY as string,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens },
    }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${body.slice(0, 300)}`);
  }
  const data = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  const text = (data.candidates?.[0]?.content?.parts ?? []).map((part) => part.text ?? "").join("");
  return {
    text,
    inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
    provider: "gemini",
    model,
  };
}
