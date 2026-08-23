---
name: Kohala platform skills API quirks
description: How POST /api/v1/agents/:id/skills really behaves — canonical `code` field, script assets, probing tricks.
---

- Skill upload schema fields (probed live 2026-08-11 by sending wrong-typed fields): `name, description, scriptFilename, code, draftCode, deployedCode`. Unknown fields (e.g. `scriptContent`) are **silently dropped** — no validation error.
- A skill only becomes runnable when the platform attaches a script asset; that happens when `scriptFilename` + `code` are both sent. The response then contains `script: { imageId, filename, stage: "production", updated }`, and `GET .../skills` shows a second record `{name, type: "script", filename, stage: "production"}` alongside the `type: "skill"` metadata record. Runs skip skills without the script record (BUG-067).
- `DELETE /agents/:id/skills/:name` wiped ALL skills on the agent, not just the named one — dangerous, treat as destructive.
- Promote route (`.../skills/:name/promote`) only applies to custom (code-only) skills; script-flavor skills are implicitly production.
- Schedule binding (BUG-077): `agentScheduleCron`+`Enabled` alone bind nothing — runs 409 `nothing_to_run`. Scripts must be bound via `agentScheduleEntries: [{scriptFilename, schedule}]` (PATCH), after the scripts exist. `agentEnabled` can also be set via PATCH /agents/:id.
- OpenAPI/status/docs endpoints are session-only; pk_ keys only reach the versioned management surface. Discover schemas by sending wrong-typed fields and reading zod `fieldErrors`.

**Why:** the platform gives green 2xx responses for payloads it partially ignores; devkit must verify `script.stage === "production"` in the upload response (implemented in 0.1.4) rather than trust status codes.
