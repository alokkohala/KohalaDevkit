# Kohala Devkit

Build and run [Kohala](https://kohala.ai) agents **entirely on your own
machine** — no account, no billing, no waitlist. When you want your agent
hosted, `kohala deploy` pushes the exact same agent to the platform.

```bash
npm install -g @kohala/devkit

kohala init my-agent
kohala run my-agent --local
kohala trace my-agent
```

That's the whole loop. Python 3 is the only other thing you need (to run
skill scripts).

## What you get

- **`kohala` CLI** — `init`, `validate`, `run --local`, `trace`,
  `memory serve`, `login`, `deploy`, `doctor`.
- **Local agent emulator** — executes your agent's charter with the
  platform's exact enforcement order: per-day admission, tool allowlist,
  per-run token caps, and validators with a bounded repair loop. Tokens are
  counted for cap enforcement and shown in the trace, but **nothing is ever
  billed locally**.
- **Open MCP memory server** — `kohala memory serve` exposes agent memory
  over the [Model Context Protocol](https://modelcontextprotocol.io) with the
  platform's tool names (`s3.put`, `s3.get`, `s3.list`, `s3.delete`). File
  backend by default; Postgres with `--backend postgres`.
- **Python script SDK** — scaffolded into every agent (`skills/_tools.py`,
  stdlib-only). Scripts talk to the runtime over a loopback RPC boundary, so
  the same script runs unchanged locally and hosted.
- **Deploy client** — `kohala deploy` maps your `kohala.json` onto the
  platform's REST API. Idempotent on agent name, additive only (never deletes
  anything remotely), with `--dry-run` to see exactly what would be sent.

## The compatibility contract

`kohala.json` is a 1:1 mapping onto platform fields:

```json
{
  "name": "my-agent",
  "charter": "Collect one interesting fact per shift.",
  "toolAllowlist": ["s3.put", "s3.get", "s3.list", "notify.send"],
  "runtimeMode": "wrap",
  "skills": { "main": "main.py" },
  "caps": { "perRunTokens": 20000, "perDayTokens": 100000 },
  "validators": [
    { "type": "shape", "minBytes": 10 },
    { "type": "freshness", "asset": "my-agent/latest", "maxAgeHours": 24 }
  ]
}
```

- `runtimeMode: "wrap"` executes your script directly and validates its
  output (stdout).
- `runtimeMode: "llm"` runs a real tool-use loop against **your own**
  `ANTHROPIC_API_KEY` — the devkit never mocks completions.

## Docs

- [Quickstart](docs/QUICKSTART.md)
- [Manifest reference](docs/MANIFEST.md)
- [How the emulator works](docs/EMULATOR.md)
- [Memory & the MCP server](docs/MEMORY.md)
- [Deploying to kohala.ai](docs/DEPLOY.md)

## Examples

- [`examples/weather-logger`](examples/weather-logger) — wrap mode, external
  HTTP + memory + freshness validator.
- [`examples/rss-digest`](examples/rss-digest) — wrap mode with
  `llm.complete` summarization (needs an LLM key).
- [`examples/llm-notes`](examples/llm-notes) — `runtimeMode: "llm"`, a real
  tool-use loop (needs `ANTHROPIC_API_KEY`).

## Requirements

- Node.js ≥ 20
- Python 3 (to run skill scripts)
- Optional: `ANTHROPIC_API_KEY` or `GEMINI_API_KEY` for LLM features
- Optional: `pg` + a Postgres URL for the Postgres memory backend
- Optional: a Kohala account — **only** for `kohala deploy`

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports and PRs welcome.

## License

[MIT](LICENSE)
