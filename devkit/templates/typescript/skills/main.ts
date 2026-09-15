import { tools } from "./_tools.js";

export async function run(): Promise<void> {
  const fact = `Shift ran at ${new Date().toISOString()}.`;
  await tools.s3Put({ key: "{{AGENT_NAME}}/latest", body: fact });
  await tools.notifySend({ channel: "dev", message: "shift completed" });
  await tools.metricsRecord({ name: "facts_stored", value: 1 });
  const existing = await tools.s3List({ prefix: "{{AGENT_NAME}}/" });

  console.log(fact);
  console.log(`memory now holds ${existing.records.length} asset(s) under "{{AGENT_NAME}}/"`);
}

// The hosted Node lane imports and invokes `run`. The local emulator executes
// this file directly and supplies KOHALA_RPC_URL.
if (process.env.KOHALA_RPC_URL) {
  await run();
}
