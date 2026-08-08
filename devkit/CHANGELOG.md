# @kohala/devkit

## 0.1.1 (unreleased)

Bug fixes.

- **Default models updated to match the hosted platform** (BUG-040).
  Local llm-mode now defaults to `claude-sonnet-4-6` (Anthropic) and
  `gemini-flash-latest` (Gemini) — the same models the platform runs — so
  cap tuning and output behaviour carry over after `kohala deploy`. Override
  locally with `ANTHROPIC_MODEL`, `GEMINI_MODEL`, or `KOHALA_LLM_MODEL`.

- **Default Gemini model changed from `gemini-2.0-flash` to
  `gemini-flash-latest`** (BUG-041). The previous default hit quota limits
  on new free-tier Gemini keys; the new default works on fresh keys.
  Override with `GEMINI_MODEL` or `KOHALA_LLM_MODEL`.

- **`kohala doctor` now correctly distinguishes llm-mode availability from
  `llm.complete` availability** (BUG-042). `GEMINI_API_KEY` enables
  `llm.complete` in wrap-mode skills but not the llm-mode tool-use loop
  (which requires `ANTHROPIC_API_KEY`). The doctor now reports each case
  separately so the output matches what actually works.

- **`kohala run` error message is now specific when `runtimeMode: "llm"` is
  used without an Anthropic key** (BUG-042). The previous message suggested
  that `GEMINI_API_KEY` would work; the new message explains the distinction.

- **`docs/` and `examples/` included in the published tarball** (BUG-034).
  The README links to both; they now ship inside the package so installed
  users can read them without cloning the repository.

- **`kohala memory serve` documentation clarified** (BUG-035). The command
  requires either `--agent <name>` or to be run from inside an agent
  directory. The docs now show both forms.

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

### SDK compatibility note (BUG-015)

0.1.0 was released against `@kohala/sdk` 0.1.x. The SDK published 0.2.0 on
2026-07-20 with updated method signatures. The emulator and deploy client
work against any SDK version; this note tracks awareness of the divergence.
