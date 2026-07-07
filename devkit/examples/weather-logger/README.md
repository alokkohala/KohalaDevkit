# weather-logger example

Wrap-mode agent that fetches current weather from Open-Meteo (no API key
needed) and stores it in memory. Shows `http.post_json`, `s3.put`, a
`freshness` validator, and an `invariant` validator.

```bash
cd examples
kohala validate weather-logger
kohala run weather-logger --local
kohala trace weather-logger
```
