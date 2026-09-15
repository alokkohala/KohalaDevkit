# Deploying to kohala.ai

Everything in the devkit works without an account. Deploy is the one step
that needs one — it pushes your locally-validated agent to the hosted
platform, unchanged.

## Login

```bash
kohala login          # paste your pk_ key from kohala.ai account settings
```

The key is stored at `~/.kohala/credentials.json` with permissions `600`.
The `KOHALA_API_KEY` environment variable **always takes precedence** over
the file — use it in CI.

## Deploy

```bash
kohala deploy my-agent --dry-run   # print exactly what would be sent
kohala deploy my-agent             # do it
kohala deploy my-agent --run       # ...and trigger a manual hosted run
kohala deploy my-agent --base-url https://staging.kohala.ai   # non-prod target
kohala deploy my-agent --allow-unknown-packages               # skip the local npm allowlist check
```

## What deploy does

Deploy maps `kohala.json` onto the platform REST API, in order:

1. `POST /api/v1/agents` — create or update the agent. **Idempotent on the
   agent name**: deploying twice updates, never duplicates.
2. `POST /api/v1/agents/:id/skills` — upload each skill script.
3. `PUT /api/v1/agents/:id/quota` — set the token caps.
4. (with `--run`) `POST /api/v1/agents/:id/agent-runs/manual` — trigger a
   run and print its URL.

Each skill upload carries the script's runtime. Python skills are sent
exactly as they always were; a TypeScript/JavaScript skill (`.ts`, `.js`, …)
also sends `runtimeLanguage: "node"` and the manifest's `dependencies` as
`scriptDependencies`. That is what makes the platform run its acceptance
checks **when the script is attached** — TypeScript compile, security scan,
and the npm allowlist — instead of letting the script fail on its first
hosted run. The CLI prints the detected language for every skill it uploads.

Deploy is **additive only** — it never deletes agents, skills, or memory
remotely. Removing a skill from kohala.json does not remove it from the
platform; do that in the Kohala dashboard.

## Errors you might see

- **401 Unauthorized** — the key was rejected. Re-run `kohala login` with a
  fresh `pk_` key, or check `KOHALA_API_KEY`.
- **403 Forbidden** — your plan does not allow the operation. Check your
  plan at kohala.ai.
- **unsupported npm dependencies for framework "custom": …** — a package in
  `dependencies` is not one the platform installs. The CLI reports this
  before sending anything; the same message comes back from the platform if
  you deploy with `--allow-unknown-packages`. See the allowlist in
  [MANIFEST.md](MANIFEST.md#script-languages).
- **Script rejected: TypeScript compile failed / security issue(s) found** —
  the platform checks a TypeScript/JavaScript script when it is attached,
  before storing it. Nothing is deployed; fix the reported lines and
  redeploy.
- **manual run not started: agent not enabled** — newly created agents start
  disabled. Enable the agent in the kohala.ai dashboard, then re-run
  `kohala deploy <agent> --run`. Enabling survives redeploys — the idempotent
  upsert does not reset it.
- **manual run not started: nothing to run** — the platform only executes
  scripts bound to an active cron schedule. Add `"schedule": "..."` (a
  5-field cron expression) to `kohala.json` and redeploy: deploy binds every
  skill script to the schedule, which also makes manual runs work.

Both messages tell you this directly; nothing is retried silently.
