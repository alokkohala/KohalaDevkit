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
```

## What deploy does

Deploy maps `kohala.json` onto the platform REST API, in order:

1. `POST /api/v1/agents` — create or update the agent. **Idempotent on the
   agent name**: deploying twice updates, never duplicates.
2. `POST /api/v1/agents/:id/skills` — upload each skill script.
3. `PUT /api/v1/agents/:id/quota` — set the token caps.
4. (with `--run`) `POST /api/v1/agents/:id/agent-runs/manual` — trigger a
   run and print its URL.

Deploy is **additive only** — it never deletes agents, skills, or memory
remotely. Removing a skill from kohala.json does not remove it from the
platform; do that in the Kohala dashboard.

## Errors you might see

- **401 Unauthorized** — the key was rejected. Re-run `kohala login` with a
  fresh `pk_` key, or check `KOHALA_API_KEY`.
- **403 Forbidden** — your plan does not allow the operation. Check your
  plan at kohala.ai.

Both messages tell you this directly; nothing is retried silently.
