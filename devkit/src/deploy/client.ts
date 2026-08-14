import fs from "node:fs";
import path from "node:path";
import type { AgentManifest } from "../manifest/schema.js";

/**
 * REST client for deploying agents to the hosted Kohala platform (A.5).
 *
 * Deploy flow (all idempotent / additive — deploy NEVER deletes remotely):
 *   1. POST /api/v1/agents                       (idempotent on name)
 *   2. POST /api/v1/agents/:id/skills            (one per manifest skill)
 *   3. PUT  /api/v1/agents/:id/quota             (the caps)
 *   4. optional: POST /api/v1/agents/:id/agent-runs/manual
 */

/** Default production API target; override with --base-url for staging. */
export const DEFAULT_BASE_URL = "https://kohala.ai";

/** Payload for creating/updating the agent — the platform's field names. */
export interface AgentPayload {
  name: string;
  charter: string;
  toolAllowlist: string[];
  // The platform stores "wrap" under its own enum name "script" (verified
  // live 2026-08-10: "llm" round-trips as "llm"); this is a display-side
  // mapping, not data loss — send the manifest value as-is.
  runtimeMode: "wrap" | "llm";
  // The platform's canonical schedule fields (BUG-069: the manifest's
  // `schedule` used to be sent as a top-level `schedule` key, which is not
  // in the platform schema and was silently dropped). Note the create path
  // honors these, but the upsert-on-existing-name path ignores them — deploy
  // therefore also PATCHes the schedule after the upsert (see setSchedule).
  agentScheduleCron?: string;
  agentScheduleEnabled?: boolean;
}

/** Payload for uploading one skill. */
export interface SkillPayload {
  name: string;
  scriptFilename: string;
  description: string;
  // The platform's canonical field for script source is `code` (BUG-067:
  // the old `scriptContent` field is not in the platform schema and was
  // silently dropped, leaving the skill without a runnable script asset).
  code: string;
}

/** Payload for the quota update — the platform's cap field names. */
export interface QuotaPayload {
  perRunTokens: number;
  perDayTokens: number;
  billingTokens?: number;
  billingPeriod?: "day" | "week" | "month";
}

/** Everything `kohala deploy` will send, assembled before any network call. */
export interface DeployPlan {
  agent: AgentPayload;
  skills: SkillPayload[];
  quota: QuotaPayload;
}

/** Map a validated manifest (+ its skill scripts on disk) onto API payloads. */
export function buildDeployPlan(manifest: AgentManifest, agentDir: string): DeployPlan {
  const skills: SkillPayload[] = Object.entries(manifest.skills).map(([name, scriptFilename]) => {
    const scriptPath = path.join(agentDir, "skills", scriptFilename);
    if (!fs.existsSync(scriptPath)) {
      throw new Error(
        `Skill "${name}" points at ${scriptFilename}, but ${scriptPath} does not exist.`,
      );
    }
    return {
      name,
      scriptFilename,
      description: `Skill "${name}" of agent "${manifest.name}"`,
      code: fs.readFileSync(scriptPath, "utf8"),
    };
  });

  return {
    agent: {
      name: manifest.name,
      charter: manifest.charter,
      toolAllowlist: manifest.toolAllowlist,
      runtimeMode: manifest.runtimeMode,
      ...(manifest.schedule
        ? { agentScheduleCron: manifest.schedule, agentScheduleEnabled: true }
        : {}),
    },
    skills,
    quota: {
      perRunTokens: manifest.caps.perRunTokens,
      perDayTokens: manifest.caps.perDayTokens,
      ...(manifest.caps.billingTokens !== undefined
        ? { billingTokens: manifest.caps.billingTokens }
        : {}),
      ...(manifest.caps.billingPeriod !== undefined
        ? { billingPeriod: manifest.caps.billingPeriod }
        : {}),
    },
  };
}

/** Error with a user-actionable message for known HTTP statuses. */
export class DeployError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "DeployError";
  }
}

/** Result of the agent upsert — the platform reports created vs updated. */
export interface AgentUpsertResult {
  id: string;
  created: boolean;
}

/** Thin authenticated HTTP client for the Kohala public REST API. */
export class KohalaClient {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string = DEFAULT_BASE_URL,
  ) {}

  private async request(method: string, apiPath: string, body?: unknown): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${apiPath}`, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    if (response.status === 401) {
      throw new DeployError(
        401,
        "401 Unauthorized: your API key was rejected. Check KOHALA_API_KEY or re-run `kohala login` with a fresh pk_ key from your Kohala account settings.",
      );
    }
    if (response.status === 403) {
      throw new DeployError(
        403,
        "403 Forbidden: your plan does not allow this operation. Check your plan at https://kohala.ai or contact support.",
      );
    }
    if (!response.ok) {
      const text = await response.text();
      throw new DeployError(
        response.status,
        `Kohala API error ${response.status} on ${method} ${apiPath}: ${text.slice(0, 500)}`,
      );
    }
    const text = await response.text();
    return text ? (JSON.parse(text) as unknown) : null;
  }

  /** Step 1: create or update the agent (idempotent on name). */
  async upsertAgent(payload: AgentPayload): Promise<AgentUpsertResult> {
    const data = (await this.request("POST", "/api/v1/agents", payload)) as {
      id?: string;
      agentId?: string;
      created?: boolean;
    };
    const id = data.id ?? data.agentId;
    if (!id) {
      throw new DeployError(500, "Platform response did not include an agent id");
    }
    return { id, created: data.created ?? false };
  }

  /** Step 2: upload one skill (script content inline). */
  async upsertSkill(agentId: string, payload: SkillPayload): Promise<void> {
    const data = (await this.request("POST", `/api/v1/agents/${agentId}/skills`, payload)) as {
      script?: { stage?: string };
    } | null;
    // BUG-067: a skill without a production-stage script asset is skipped by
    // every run. The platform confirms attachment via `script.stage`; treat
    // its absence as a hard failure rather than reporting a green tick.
    if (data?.script?.stage !== "production") {
      throw new DeployError(
        500,
        `Platform accepted skill "${payload.name}" but did not attach a runnable script ` +
          `(expected script.stage "production" in the response). The deployed agent would ` +
          `no-op on every run — aborting.`,
      );
    }
  }

  /**
   * Step 2b (only when the manifest has a schedule): persist the cron AND
   * bind it to the agent's scripts.
   *
   * BUG-069: POST /agents honors agentScheduleCron on *create* but silently
   * ignores it when upserting an existing agent, so deploy PATCHes the
   * schedule explicitly and verifies it round-tripped. Never called without
   * a schedule — deploy is additive and must not disable existing schedules.
   *
   * BUG-077: `agentScheduleCron` + `agentScheduleEnabled` alone are NOT
   * enough for the agent to run — nothing binds the script until
   * `agentScheduleEntries` names it. Without the binding a scheduled tick
   * (and a manual run) finds no cron-invoked Production script and refuses
   * with 409 nothing_to_run, despite every deploy step reporting green.
   * Deploy therefore sends one entry per deployed script filename and
   * verifies every filename round-tripped. This runs AFTER the skill
   * uploads so the entries always reference scripts that exist remotely.
   */
  async setSchedule(agentId: string, cron: string, scriptFilenames: string[]): Promise<void> {
    const filenames = [...new Set(scriptFilenames)];
    const data = (await this.request("PATCH", `/api/v1/agents/${agentId}`, {
      agentScheduleCron: cron,
      agentScheduleEnabled: true,
      // Deploy is additive: only send entries when there are scripts to
      // bind — an empty array could clear bindings made outside the CLI.
      ...(filenames.length > 0
        ? {
            agentScheduleEntries: filenames.map((scriptFilename) => ({
              scriptFilename,
              schedule: cron,
            })),
          }
        : {}),
    })) as {
      agentScheduleCron?: string | null;
      agentScheduleEnabled?: boolean;
      agentScheduleEntries?: Array<{ scriptFilename?: string | null }> | null;
    } | null;
    if (data?.agentScheduleCron !== cron || data?.agentScheduleEnabled !== true) {
      throw new DeployError(
        500,
        `Platform did not persist the schedule "${cron}" (got ` +
          `agentScheduleCron=${JSON.stringify(data?.agentScheduleCron)}, ` +
          `agentScheduleEnabled=${JSON.stringify(data?.agentScheduleEnabled)}) — aborting.`,
      );
    }
    const boundFilenames = new Set(
      (Array.isArray(data?.agentScheduleEntries) ? data.agentScheduleEntries : [])
        .map((entry) => entry?.scriptFilename)
        .filter((f): f is string => typeof f === "string"),
    );
    const unbound = filenames.filter((f) => !boundFilenames.has(f));
    if (unbound.length > 0) {
      throw new DeployError(
        500,
        `Platform persisted the cron but did not bind it to script(s) ` +
          `${unbound.map((f) => `"${f}"`).join(", ")} (agentScheduleEntries=` +
          `${JSON.stringify(data?.agentScheduleEntries ?? null)}). The agent would ` +
          `refuse to run with 409 nothing_to_run — aborting.`,
      );
    }
  }

  /** Step 3: set the token caps. */
  async setQuota(agentId: string, payload: QuotaPayload): Promise<void> {
    await this.request("PUT", `/api/v1/agents/${agentId}/quota`, payload);
  }

  /** Optional step 4 (--run): trigger a manual run and return its link. */
  async triggerManualRun(agentId: string): Promise<string> {
    const data = (await this.request("POST", `/api/v1/agents/${agentId}/agent-runs/manual`)) as {
      runUrl?: string;
      url?: string;
      id?: string;
    };
    return data.runUrl ?? data.url ?? `${this.baseUrl}/agents/${agentId}/runs/${data.id ?? ""}`;
  }
}
