# Security Policy

## Supported versions

Only the latest published version of `@kohala/devkit` receives security
fixes.

## Reporting a vulnerability

Please email **security@kohala.ai** with a description of the issue, steps to
reproduce, and the version affected. Do **not** open a public GitHub issue
for security reports.

We aim to acknowledge reports within 3 business days.

## Scope notes

- The devkit runs agent scripts **you** wrote on **your** machine, with your
  own credentials. It does not sandbox skill scripts — treat third-party
  agent code like any other code you execute locally.
- The `http.post_json` tool refuses private/internal targets: it validates
  the hostname, every IP it resolves to (IPv4 and IPv6, including
  IPv4-mapped, link-local, ULA, and CGNAT ranges), and re-validates each
  redirect hop. A determined attacker with DNS rebinding at request time may
  still find gaps — do not treat it as a hardened network boundary.
- `kohala login` stores your API key at `~/.kohala/credentials.json` with
  mode 600. The `KOHALA_API_KEY` environment variable always takes
  precedence and is the recommended mechanism in CI.
