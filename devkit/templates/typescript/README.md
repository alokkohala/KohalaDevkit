# {{AGENT_NAME}}

A TypeScript Kohala agent scaffolded by `kohala init --language ts`.

## Commands

```bash
npm install
npm run typecheck
kohala validate {{AGENT_NAME}}
kohala run {{AGENT_NAME}} --local
kohala deploy {{AGENT_NAME}} --dry-run
```

Run the Kohala commands from the directory containing the `{{AGENT_NAME}}/`
folder. Edit `skills/main.ts`; use `skills/_tools.ts` for typed, governed
platform tool calls. The same loopback RPC interface is available when hosted.
