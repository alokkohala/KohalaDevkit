# Memory & the MCP server

Agent memory locally has the same surface as the hosted platform:

- `s3.put(key, body, category?)` — store under a logical key. Category
  defaults to `"agentoutput"` (run results).
- `s3.get(keyOrId)` — resolve by active logical key first, then record id.
- `s3.list(prefix?, limit?)` — active assets, newest first.
- `s3.delete(keyOrId)` — remove the body + deactivate the index entry
  (soft delete).

Logical keys are unique among active assets: putting to an existing key
updates it in place.

## Backends

### file (default)

```
.kohala/memory/<agent>/
├── index.json     # asset index: key, category, timestamps, active flag
└── bodies/<id>    # raw body bytes, one file per asset
```

The index is rewritten atomically (temp file + rename) on every mutation.

### postgres

```bash
kohala memory serve --backend postgres --url postgres://...   # or DATABASE_URL
kohala run my-agent --local --backend postgres
```

One table, `kohala_memory`, created automatically on first connect. Bodies
are stored as `bytea` in the same row — a deliberate design decision so any
plain Postgres URL works with no filesystem coupling. Requires the optional
`pg` package (`npm install pg`).

## The MCP server

`kohala memory serve` exposes memory over the
[Model Context Protocol](https://modelcontextprotocol.io) so any MCP client
(Claude Desktop, MCP Inspector, your own tools) can read and write agent
memory with the platform's exact tool names.

```bash
# stdio (default) — for clients that spawn a child process
kohala memory serve --agent my-agent

# streamable HTTP — for MCP Inspector etc.
kohala memory serve --agent my-agent --http --port 8787
# endpoint: http://127.0.0.1:8787/mcp
```

Tools: `s3.put`, `s3.get`, `s3.list`, `s3.delete`.
Resource: `memory://index` — a JSON listing of all active assets.

Claude Desktop config example:

```json
{
  "mcpServers": {
    "kohala-memory": {
      "command": "kohala",
      "args": ["memory", "serve", "--agent", "my-agent"]
    }
  }
}
```

Run it from the directory that contains your `.kohala/` folder (or from
inside the agent directory — the server resolves the agent name from
kohala.json and uses the parent directory as the workspace root).
