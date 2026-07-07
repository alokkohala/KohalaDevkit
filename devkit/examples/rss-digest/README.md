# rss-digest example

Wrap-mode agent that fetches Hacker News front-page headlines and summarizes
them with `llm.complete` — using **your own** `ANTHROPIC_API_KEY` (or
`GEMINI_API_KEY`). Without a key the run fails loudly with `NO_LLM_KEY`;
there is no mock fallback.

```bash
export ANTHROPIC_API_KEY=sk-ant-...
cd examples
kohala run rss-digest --local
kohala trace rss-digest     # note the `tokens` events — counted, never billed
```
