# @kohala/devkit

## 0.1.5

- **BUG-069 fixed: the manifest `schedule` now actually lands on the
  platform.** The CLI used to send it as a top-level `schedule` key that is
  not in the platform schema and was silently dropped (agent deployed green,
  `agentScheduleCron` stayed null). Deploy now sends the platform's canonical
  `agentScheduleCron` + `agentScheduleEnabled` fields, and — because the
  platform honors them only on agent *create*, not on the idempotent
  upsert-by-name update — additionally PATCHes the schedule after the upsert
  and verifies it round-tripped, failing loudly if it did not. Deploy stays
  additive: no schedule in the manifest means the schedule fields are not
  sent at all, so an existing schedule is never disabled.

## 0.1.4

- **BUG-067 fixed: skills deployed by `kohala deploy` are now actually
  runnable.** The CLI used to send the script source in a `scriptContent`
  field that is not in the platform schema, so the platform stored bare skill
  metadata with no script asset — the agent deployed with green ticks but
  every run skipped its skills. The script source is now sent in the
  platform's canonical `code` field, which makes the platform attach a
  production-stage script asset (verified live: `GET .../skills` shows
  `{"type":"script","filename":...,"stage":"production"}`, the same record
  shape Kai's `agent.attachScript` produces).
- **Deploy now verifies the script actually attached.** The platform confirms
  attachment via `script.stage: "production"` in the skill-upload response;
  if it is missing, deploy fails loudly instead of reporting a green tick for
  an agent that would no-op.

## 0.1.3

- **`kohala deploy --run` now explains the "agent not enabled" case instead of
  a raw 409 API error.** Newly deployed agents start disabled on the platform,
  so a manual run cannot start until the agent is enabled in the kohala.ai
  dashboard. The CLI now says exactly that (deploy itself still succeeds; exit
  code stays non-zero so scripts notice the run did not start).

- **Documented the platform's runtimeMode display mapping.** The platform
  stores `wrap` under its own enum name `script` (`llm` round-trips as `llm`);
  verified live — this is display-side naming, not data loss.

## 0.1.2

- **`kohala validate` now rejects tool ids not in the bundled platform
  catalog snapshot** (BUG-033). A typo'd tool id (e.g. `htpp.geet`) used to
  pass validation and only fail at deploy/run time; it now fails validation
  offline with the offending id(s) named. Pass `--allow-unknown-tools` to
  bypass when the snapshot lags newly added platform tools — the deploy
  endpoint still verifies against the live catalog authoritatively.

- **Docs: LLM model-override env vars and `memory serve` agent scoping**
  (BUG-047, BUG-035). The README now documents `KOHALA_LLM_MODEL`,
  `ANTHROPIC_MODEL`, and `GEMINI_MODEL`, and clarifies that
  `kohala memory serve` is always scoped to one agent (run it inside an
  agent directory or pass `--agent <name>`).

- **Repo hygiene: removed Replit workspace scaffolding from the repository**
  (BUG-016). `.replit`, `replit.md`, `attached_assets/`, and `artifacts/`
  are no longer tracked in the public repo.

## 0.1.1

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
