# How the emulator works

`kohala run <agent> --local` executes one **shift** with the same enforcement
order the hosted platform uses. Nothing is mocked, nothing is billed.

## Enforcement order

1. **Admission (per-day cap).** Before any work, the emulator sums today's
   (UTC) token usage from `.kohala/usage/<agent>.json`. If it has already
   reached `caps.perDayTokens`, the shift is refused with
   `PER_DAY_TOKEN_CAP` — exactly like the platform's admission check.
2. **Tool allowlist.** Every tool call — from a wrap-mode script over RPC or
   from the llm-mode loop — is checked against `toolAllowlist`. Disallowed
   calls fail with `TOOL_DENIED` and the denial is recorded in the trace.
3. **Per-run cap.** Before each LLM turn (an `llm.complete` call in wrap
   mode, or a loop turn in llm mode), the emulator projects the turn's token
   cost. If the projection would cross `caps.perRunTokens`, the run aborts
   with `PER_RUN_TOKEN_CAP` instead of crossing it.
4. **Validators + repair loop.** After the output is produced, all
   validators run. On failure, wrap mode re-runs the script with feedback,
   at most **2** repair attempts (platform default), then the run is marked
   `failed`.

## Token accounting — counted, never billed

Tokens are estimated at ~4 characters/token for projections; actual LLM
usage comes from the provider's response. Totals are written to the trace
(`tokens` events) and to the per-day ledger. **No money is involved
locally, ever.** The caps exist so your agent behaves identically when
deployed.

## The script boundary (wrap mode)

Skill scripts run as a separate Python process and talk to the emulator over
a loopback HTTP RPC endpoint — the same boundary shape the platform uses.
The emulator passes:

| Env var | Meaning |
| --- | --- |
| `KOHALA_RPC_URL` | Loopback endpoint for tool calls (`skills/_tools.py` uses it) |
| `KOHALA_AGENT` | Agent name |
| `KOHALA_RUN_ID` | Unique shift id |
| `KOHALA_REPAIR_ATTEMPT` | `0` first try, `1`–`2` on repair attempts |
| `KOHALA_VALIDATOR_FEEDBACK` | Why validators failed last attempt |

The script's **stdout is the run output**; stderr passes through to your
terminal for debugging.

## llm mode

A real Anthropic tool-use loop with your own `ANTHROPIC_API_KEY`:

- `charter` → system prompt
- skill file contents → task context
- allowlisted tools → tool definitions (the model can't even see others)
- every tool invocation goes through the same dispatcher as wrap mode

If no key is configured the run fails with `NO_LLM_KEY`. There is no mock
fallback by design.

## The trace

Every shift appends JSONL events to `.kohala/trace/<agent>.jsonl`:
`run_started`, `tool_call` (with allow/deny and duration), `tokens`,
`validator_result`, `repair_attempt`, `run_finished`. Inspect with
`kohala trace <agent>` (`--follow`, `--json`).
