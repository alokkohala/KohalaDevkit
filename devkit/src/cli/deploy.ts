import path from "node:path";
import type { Command } from "commander";
import pc from "picocolors";
import { loadManifest } from "../manifest/load.js";
import { resolveApiKey } from "../deploy/credentials.js";
import {
  buildDeployPlan,
  buildScheduleEntries,
  DEFAULT_BASE_URL,
  DeployError,
  KohalaClient,
} from "../deploy/client.js";

/**
 * `kohala deploy <agent>` — push a locally-validated agent to the hosted
 * platform. Deploy is additive and idempotent on the agent name; it never
 * deletes anything remotely. `--dry-run` prints exactly what would be sent.
 */
export function registerDeployCommand(program: Command): void {
  program
    .command("deploy")
    .argument("<agent>", "agent directory (containing kohala.json)")
    .option("--dry-run", "print the payloads without sending anything")
    .option("--base-url <url>", "API base URL", DEFAULT_BASE_URL)
    .option("--run", "trigger a manual run after deploying")
    .description("Deploy an agent to kohala.ai (idempotent on agent name)")
    .action(
      async (
        agent: string,
        options: { dryRun?: boolean; baseUrl: string; run?: boolean },
      ) => {
        const agentDir = path.resolve(process.cwd(), agent);
        const manifest = loadManifest(agentDir);
        const plan = buildDeployPlan(manifest, agentDir);

        if (options.dryRun) {
          console.log(pc.cyan("Dry run — nothing will be sent. Deploy plan:"));
          console.log("");
          console.log(pc.bold("1. POST /api/v1/agents (idempotent on name)"));
          console.log(JSON.stringify(plan.agent, null, 2));
          for (const skill of plan.skills) {
            console.log("");
            console.log(pc.bold(`2. POST /api/v1/agents/:id/skills — "${skill.name}"`));
            console.log(
              JSON.stringify(
                { ...skill, code: `<${Buffer.byteLength(skill.code)} bytes of ${skill.scriptFilename}>` },
                null,
                2,
              ),
            );
          }
          if (plan.agent.agentScheduleCron) {
            console.log("");
            console.log(
              pc.bold(
                "2b. PATCH /api/v1/agents/:id (persist schedule on updates + bind the scripts)",
              ),
            );
            const entries = buildScheduleEntries(
              plan.agent.agentScheduleCron,
              plan.skills.map((s) => s.scriptFilename),
            );
            console.log(
              JSON.stringify(
                {
                  agentScheduleCron: plan.agent.agentScheduleCron,
                  agentScheduleEnabled: true,
                  // Same conditional builder as the real request: omitted
                  // entirely when there is nothing to bind.
                  ...(entries ? { agentScheduleEntries: entries } : {}),
                },
                null,
                2,
              ),
            );
            if (entries) {
              console.log(
                pc.dim(
                  "   (bindings for scripts not in this manifest are read from the platform and preserved)",
                ),
              );
            }
          }
          console.log("");
          console.log(pc.bold("3. PUT /api/v1/agents/:id/quota"));
          console.log(JSON.stringify(plan.quota, null, 2));
          if (options.run) {
            console.log("");
            console.log(pc.bold("4. POST /api/v1/agents/:id/agent-runs/manual"));
          }
          return;
        }

        const apiKey = resolveApiKey();
        if (!apiKey) {
          throw new Error(
            "No API key configured. Run `kohala login` (or set KOHALA_API_KEY) first. Keys come from your kohala.ai account settings.",
          );
        }

        const client = new KohalaClient(apiKey, options.baseUrl);
        console.log(pc.cyan(`Deploying "${manifest.name}" to ${options.baseUrl} ...`));

        const upserted = await client.upsertAgent(plan.agent);
        console.log(
          pc.green(`  ✔ agent ${upserted.created ? "created" : "updated"} (id ${upserted.id})`),
        );

        for (const skill of plan.skills) {
          await client.upsertSkill(upserted.id, skill);
          console.log(pc.green(`  ✔ skill "${skill.name}" uploaded (${skill.scriptFilename})`));
        }

        // BUG-077: the schedule step runs AFTER the skill uploads and binds
        // the cron to every deployed script via agentScheduleEntries — the
        // agent-level cron alone leaves nothing bound and the agent refuses
        // to run (409 nothing_to_run) despite an all-green deploy.
        if (plan.agent.agentScheduleCron) {
          const filenames = plan.skills.map((s) => s.scriptFilename);
          await client.setSchedule(upserted.id, plan.agent.agentScheduleCron, filenames);
          console.log(
            pc.green(
              `  ✔ schedule set (${plan.agent.agentScheduleCron}) and bound to ` +
                `${[...new Set(filenames)].join(", ") || "(no scripts)"}`,
            ),
          );
        }

        await client.setQuota(upserted.id, plan.quota);
        console.log(
          pc.green(
            `  ✔ quota set (perRun=${plan.quota.perRunTokens}, perDay=${plan.quota.perDayTokens})`,
          ),
        );

        if (options.run) {
          try {
            const runUrl = await client.triggerManualRun(upserted.id);
            console.log(pc.green(`  ✔ manual run triggered: ${runUrl}`));
          } catch (error) {
            // Newly deployed agents start disabled on the platform; a manual
            // run returns 409 until the owner enables the agent. Explain the
            // fix instead of surfacing a raw API error — but keep a non-zero
            // exit so scripts relying on --run notice the run did not happen.
            if (error instanceof DeployError && error.status === 409) {
              console.error(
                pc.yellow(
                  `  ✖ manual run not started: the agent is not enabled on the platform yet.`,
                ),
              );
              console.error(
                pc.dim(
                  `    Deploy itself succeeded. Enable "${manifest.name}" in your kohala.ai dashboard, ` +
                    `then re-run \`kohala deploy ${agent} --run\` (or trigger a run from the dashboard).`,
                ),
              );
              process.exitCode = 1;
              return;
            }
            throw error;
          }
        }

        console.log("");
        console.log(pc.green(`Deployed. Deploys are additive — nothing was deleted remotely.`));
      },
    );
}
