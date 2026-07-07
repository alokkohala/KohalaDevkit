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
  runtimeMode: "wrap" | "llm";
  schedule?: string;
}

/** Payload for uploading one skill. */
export interface SkillPayload {
  name: string;
  scriptFilename: string;
  description: string;
  scriptContent: string;
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
      scriptContent: fs.readFileSync(scriptPath, "utf8"),
    };
  });

  return {
    agent: {
      name: manifest.name,
      charter: manifest.charter,
      toolAllowlist: manifest.toolAllowlist,
      runtimeMode: manifest.runtimeMode,
      ...(manifest.schedule ? { schedule: manifest.schedule } : {}),
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
    await this.request("POST", `/api/v1/agents/${agentId}/skills`, payload);
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
