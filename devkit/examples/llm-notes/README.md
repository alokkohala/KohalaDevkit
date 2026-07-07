# llm-notes example

`runtimeMode: "llm"` — a real tool-use loop against your own
`ANTHROPIC_API_KEY`. The charter is the system prompt, `skills/task.md` is
the task context, and the allowlisted tools (`s3.put`, `s3.get`, `s3.list`,
`notify.send`) are exposed to the model. Every tool call the model makes goes
through the same allowlist + trace + token accounting as wrap mode.

Before each turn the emulator projects the request's token cost against
`caps.perRunTokens` and aborts with `PER_RUN_TOKEN_CAP` rather than crossing
it.

```bash
export ANTHROPIC_API_KEY=sk-ant-...
cd examples
kohala run llm-notes --local
kohala trace llm-notes
```
