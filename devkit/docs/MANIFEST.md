# Manifest reference — kohala.json

`kohala.json` is the agent's single source of truth, and it maps 1:1 onto
platform fields. Deploying never re-interprets it — what you validate locally
is what goes live.

## Full example

```json
{
  "name": "weather-logger",
  "charter": "Fetch current weather once per shift and store it in memory.",
  "toolAllowlist": ["s3.put", "s3.get", "s3.list", "http.post_json"],
  "runtimeMode": "wrap",
  "skills": { "collect": "main.py" },
  "schedule": "0 * * * *",
  "caps": {
    "perRunTokens": 10000,
    "perDayTokens": 50000,
    "billingTokens": 1000000,
    "billingPeriod": "month"
  },
  "validators": [
    { "type": "shape", "minBytes": 20 },
    { "type": "freshness", "asset": "weather/latest", "maxAgeHours": 2 },
    { "type": "invariant", "pattern": "temperature", "mustMatch": true }
  ]
}
```

## Fields

| Field | Platform field | Meaning |
| --- | --- | --- |
| `name` | agent name | Identity. Deploy is idempotent on it. Letters, digits, `-`, `_`. |
| `charter` | `agentCharter` | The agent's mission. In llm mode this is the system prompt. |
| `toolAllowlist` | `agentToolAllowlist` | Exactly the tools the agent may call. No implicit grants. |
| `runtimeMode` | `agentRuntimeMode` | `"wrap"` or `"llm"` (see below). |
| `skills` | `agentSkills` | Map of skill name → script filename in `skills/`. |
| `schedule` | `agentScheduleCron` | Cron expression. Only used on deploy; local runs are manual. |
| `caps.perRunTokens` | `agentPerRunTokenCap` | Hard token ceiling per shift. |
| `caps.perDayTokens` | `agentPerDayTokenCap` | Cumulative ceiling per UTC day. |
| `caps.billingTokens` | `agentBillingCapTokens` | Billing-period cap. Ignored locally. |
| `caps.billingPeriod` | `agentBillingCapPeriod` | `"day"`, `"week"`, or `"month"`. Required with `billingTokens`. |
| `validators` | agent validators | Output checks (below). |

## Runtime modes

- **`wrap`** — the emulator executes the skill script directly (Python 3).
  The script's **stdout is the run output** that validators evaluate; stderr
  is for your debug logging. The script uses `skills/_tools.py` to call
  tools over the loopback RPC boundary.
- **`llm`** — a real tool-use loop against your own `ANTHROPIC_API_KEY`. The
  charter is the system prompt, the skill file's contents are the task
  context, and allowlisted tools are exposed to the model. The final text
  reply is the run output.

## Tools

`s3.put`, `s3.get`, `s3.list`, `s3.delete`, `http.post_json`,
`llm.complete`, `notify.send`, `metrics.record` — identical names and
semantics locally and hosted. Locally, `notify.send` and `metrics.record`
land in the trace instead of sending anything.

## Validators

- `{"type": "shape", "minBytes": n}` — output must exist and be ≥ n bytes.
- `{"type": "freshness", "asset": "key", "maxAgeHours": h}` — the memory
  asset at `key` must have been updated within the last `h` hours.
- `{"type": "invariant", "pattern": "regex", "mustMatch": true|false}` —
  output must match (or must not match) the regex.

On failure, wrap mode re-runs the script up to **2** more times with
`KOHALA_REPAIR_ATTEMPT` and `KOHALA_VALIDATOR_FEEDBACK` set — the platform's
bounded repair loop.

## Validation errors

`kohala validate <agent>` prints every problem with a fix hint, e.g.:

```
kohala.json failed validation
  • caps.perRunTokens: Expected number, received string (hint: set caps.perRunTokens and caps.perDayTokens as positive integers)
```
