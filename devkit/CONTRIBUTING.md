# Contributing to the Kohala Devkit

Thanks for helping! The devkit is deliberately small and boring — please keep
it that way.

## Setup

```bash
git clone https://github.com/kohala-ai/devkit
cd devkit
npm install         # or pnpm install
npm run build
node dist/cli/index.js --version
```

Python 3 must be on your PATH to run the end-to-end tests.

## Development loop

```bash
npm run typecheck   # strict tsc, no emit
npm run lint        # eslint
npm test            # vitest (unit + CLI e2e)
npm run build       # tsup -> dist/
```

## Ground rules

- **Errors fail loudly.** No silent fallbacks, no mock LLM responses, no
  swallowed exceptions. If something can't work, say so with an actionable
  message.
- **Platform parity is the product.** Tool names, manifest fields, cap codes
  (`PER_RUN_TOKEN_CAP`, `PER_DAY_TOKEN_CAP`, `TOOL_DENIED`), and enforcement
  order must match the hosted platform. Don't rename things casually.
- **Dependency budget.** Runtime deps are limited to: commander, zod,
  @modelcontextprotocol/sdk, execa, picocolors, ora. `pg` stays an optional
  peer. New runtime dependencies need a strong justification in the PR.
- **The Python SDK stays stdlib-only.** Scaffolded agents must run without a
  single `pip install`.
- Keep CLI command files thin; put behavior in the library modules where it
  can be unit-tested.

## Submitting changes

1. Fork, branch, make the change, add/adjust tests.
2. Add a changeset: `npx changeset` (pick patch/minor and write one line).
3. Open a PR. CI runs typecheck, lint, tests, and build on Node 20 and 22.

## Releases

Releases are automated with [changesets](https://github.com/changesets/changesets):
merged changesets accumulate, and the release workflow versions, tags, and
publishes to npm.
