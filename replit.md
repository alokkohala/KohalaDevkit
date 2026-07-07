# Kohala Devkit

Standalone MIT-licensed npm package `@kohala/devkit` (in `devkit/`) — a CLI + local emulator that lets developers build and run Kohala agents entirely on their own machine, then deploy the same agent to kohala.ai.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `devkit/` — the whole product: standalone npm package `@kohala/devkit` (pure code, no web artifact)
  - `src/cli/` — `kohala` CLI commands (init, validate, run, trace, memory-serve, login, deploy, doctor)
  - `src/manifest/` — kohala.json Zod schema + loader with fix hints
  - `src/emulator/` — local shift runner: tokens/caps, allowlist, validators, wrap-mode + llm-mode
  - `src/memory/` — file (atomic index + bodies) and Postgres (single-table bytea) backends
  - `src/mcp/` — MCP memory server (stdio + streamable HTTP)
  - `src/sdk/` — ToolDispatcher + loopback RPC server the Python SDK talks to
  - `src/deploy/` — credentials + kohala.ai REST deploy client
  - `templates/` — `kohala init` scaffold, incl. stdlib-only `skills/_tools.py` Python SDK
  - `examples/`, `docs/`, `test/` — three example agents, five docs, vitest suite
- Devkit commands (run from repo root): `pnpm --filter @kohala/devkit run build|test|lint|typecheck`

## Architecture decisions

- Devkit is standalone-publishable: no `catalog:`/`workspace:` deps (zod ^3.25.76 pinned); `pg` is an optional peer, lazy-imported
- Platform parity is the contract: tool names (`s3.put`…), cap codes (`PER_RUN_TOKEN_CAP`, `PER_DAY_TOKEN_CAP`, `TOOL_DENIED`), and enforcement order (day admission → allowlist → per-run projection → validators + 2-attempt repair loop) mirror the hosted platform
- Errors are always loud — no mock LLM responses, no silent fallbacks; llm features need the user's own `ANTHROPIC_API_KEY`
- Wrap-mode scripts run as a separate Python process over loopback HTTP RPC (`KOHALA_RPC_URL`); script stdout is the run output
- Anthropic tool names transport dots as `__` (API name charset restriction), mapped back on dispatch
- State lives under the workspace cwd: `.kohala/{memory,trace,usage}/`

## Product

`npm i -g @kohala/devkit` → `kohala init/validate/run --local/trace` gives the full agent loop with zero account or billing; `kohala memory serve` exposes agent memory over MCP; `kohala login` + `kohala deploy` push the same agent to kohala.ai.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
