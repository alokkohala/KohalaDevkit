# @kohala/devkit

## 0.1.0

Initial release.

- `kohala` CLI: `init`, `validate`, `run --local`, `trace`, `memory serve`,
  `login`, `deploy`, `doctor`
- Local agent emulator with platform-parity enforcement: per-day admission,
  tool allowlist, per-run token caps, validators with bounded repair loop
- Open MCP memory server (stdio + streamable HTTP) with file and Postgres
  backends
- Stdlib-only Python script SDK over a loopback RPC boundary
- Deploy client for the kohala.ai REST API (idempotent, additive,
  `--dry-run`)
