/**
 * Tool allowlist enforcement.
 *
 * The platform checks every tool call an agent makes against
 * `agentToolAllowlist`; the emulator applies the identical rule to
 * `toolAllowlist` from kohala.json. There are no implicit grants — a tool the
 * manifest does not list is denied loudly, and the denial is recorded in the
 * trace.
 */

/** Thrown when a script or LLM loop calls a tool that is not allowlisted. */
export class ToolDeniedError extends Error {
  constructor(readonly tool: string, allowlist: readonly string[]) {
    super(
      `TOOL_DENIED: "${tool}" is not in the agent's toolAllowlist ` +
        `[${allowlist.join(", ")}]. Add it to kohala.json if the agent should be able to use it.`,
    );
    this.name = "ToolDeniedError";
  }
}

/** True when the manifest allows this exact tool name. */
export function isToolAllowed(allowlist: readonly string[], tool: string): boolean {
  return allowlist.includes(tool);
}

/** Assert a tool is allowed; throws ToolDeniedError otherwise. */
export function assertToolAllowed(allowlist: readonly string[], tool: string): void {
  if (!isToolAllowed(allowlist, tool)) {
    throw new ToolDeniedError(tool, allowlist);
  }
}
