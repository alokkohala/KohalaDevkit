# Quickstart

From zero to a running agent in under five minutes. No account needed.

## Install

```bash
npm install -g @kohala/devkit
kohala --version
kohala doctor        # checks Node, Python, keys
```

Requirements: Node.js ≥ 20 and Python 3 on your PATH.

## Create an agent

```bash
kohala init my-agent
```

This scaffolds:

```
my-agent/
├── kohala.json        # manifest: charter, tools, caps, validators
├── README.md
└── skills/
    ├── main.py        # the skill — its stdout is the run output
    └── _tools.py      # the local tool SDK (stdlib-only, don't edit)
```

## Run it

```bash
kohala validate my-agent
kohala run my-agent --local
```

You'll see the run status, token count, validator results, and the output.
The emulator enforces the platform's exact rules — per-day admission, tool
allowlist, per-run token caps, validators with a bounded repair loop — but
**never bills anything**.

## Inspect the audit trail

```bash
kohala trace my-agent            # pretty view
kohala trace my-agent --follow   # tail it live
kohala trace my-agent --json     # raw JSONL
```

Every tool call, token increment, validator result, and repair attempt is in
there.

## Iterate

Edit `my-agent/skills/main.py` and `my-agent/kohala.json`, then run again.
Try removing a tool from `toolAllowlist` and watch the call fail loudly with
`TOOL_DENIED` — that is exactly what the platform would do.

## Go live (optional)

```bash
kohala login                    # paste your pk_ key from kohala.ai
kohala deploy my-agent --dry-run    # see exactly what would be sent
kohala deploy my-agent --run        # deploy + trigger a hosted run
```

Next: [Manifest reference](MANIFEST.md) · [How the emulator works](EMULATOR.md)
· [Memory & MCP](MEMORY.md) · [Deploying](DEPLOY.md)
