---
name: KohalaDevkit release process
description: How @kohala/devkit releases work and repo/workspace tracking quirks
---
- Direct pushes to `main` on github.com/alokkohala/KohalaDevkit are blocked; all changes go through PRs (user merges).
- The Release GitHub Action publishes to npm only when `devkit/package.json` version is new on npm — always bump the version in the same PR as the fixes.
- **Why:** merging without a bump silently skips publishing; a 404 on publish means the `NPM_TOKEN` GitHub secret lacks rights — a Classic Automation npm token from the package-owner account fixes it (granular tokens easily miss the scope).
- Replit workspace scaffolding (`.replit`, `replit.md`, `attached_assets/`, `artifacts/`) is intentionally untracked/gitignored but kept on local disk — never `git rm` it outright (breaks the workspace) and never re-add it to the public repo. `lib/` and `scripts/` ARE product and stay tracked.
- `devkit/src/manifest/known-tools.ts` is a platform-side catalog export snapshot — never regenerate or hand-edit ids; new snapshots come from the user/platform.
