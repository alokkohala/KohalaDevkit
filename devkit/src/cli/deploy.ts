import path from "node:path";
import type { Command } from "commander";
import pc from "picocolors";
import { loadManifest } from "../manifest/load.js";
import { resolveApiKey } from "../deploy/credentials.js";
import {
  buildDeployPlan,
  DEFAULT_BASE_URL,
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
                { ...skill, scriptContent: `<${Buffer.byteLength(skill.scriptContent)} bytes of ${skill.scriptFilename}>` },
                null,
                2,
              ),
            );
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

        await client.setQuota(upserted.id, plan.quota);
        console.log(
          pc.green(
            `  ✔ quota set (perRun=${plan.quota.perRunTokens}, perDay=${plan.quota.perDayTokens})`,
          ),
        );

        if (options.run) {
          const runUrl = await client.triggerManualRun(upserted.id);
          console.log(pc.green(`  ✔ manual run triggered: ${runUrl}`));
        }

        console.log("");
        console.log(pc.green(`Deployed. Deploys are additive — nothing was deleted remotely.`));
      },
    );
}
