# {{AGENT_NAME}}

A Kohala agent scaffolded by `kohala init`. Everything here runs on your own
machine — no account, no billing, no waitlist.

## Files

- `kohala.json` — the agent manifest: charter, tools, caps, validators.
- `skills/main.py` — the skill script. Its stdout is the run output.
- `skills/_tools.py` — the local tool SDK (stdlib-only). Don't edit; it is the
  same interface the hosted platform provides.

## Commands

```bash
kohala validate {{AGENT_NAME}}      # check kohala.json
kohala run {{AGENT_NAME}} --local   # run one shift with the local emulator
kohala trace {{AGENT_NAME}}         # inspect the audit trail
```

Run these from the directory *containing* the `{{AGENT_NAME}}/` folder.

## What the emulator enforces (exactly like the platform)

1. **Admission** — refuses the shift if today's runs already hit `caps.perDayTokens`.
2. **Tool allowlist** — every tool call is checked; anything not in
   `toolAllowlist` fails with `TOOL_DENIED`.
3. **Per-run cap** — LLM calls abort with `PER_RUN_TOKEN_CAP` before crossing
   `caps.perRunTokens`.
4. **Validators** — `shape`, `freshness`, and `invariant` checks run on the
   output, with up to 2 repair attempts.

Tokens are counted and shown in the trace, but nothing is ever billed locally.

## Going live (optional)

```bash
kohala login                      # paste your pk_ key from kohala.ai
kohala deploy {{AGENT_NAME}}      # idempotent; never deletes anything remotely
```
