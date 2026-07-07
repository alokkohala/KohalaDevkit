import fs from "node:fs";
import type { TraceEvent } from "./events.js";

/**
 * Parse the full contents of a JSONL trace file.
 *
 * Unparseable lines are surfaced as errors rather than skipped — a corrupt
 * audit trail should be loud, not silently truncated.
 */
export function readTraceFile(filePath: string): TraceEvent[] {
  const raw = fs.readFileSync(filePath, "utf8");
  return parseTraceLines(raw);
}

/** Parse raw JSONL text into events. Throws on malformed lines. */
export function parseTraceLines(raw: string): TraceEvent[] {
  const events: TraceEvent[] = [];
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = (lines[i] ?? "").trim();
    if (line === "") continue;
    try {
      events.push(JSON.parse(line) as TraceEvent);
    } catch {
      throw new Error(`Malformed trace line ${i + 1}: ${line.slice(0, 120)}`);
    }
  }
  return events;
}

/**
 * Follow a trace file, invoking `onEvent` for each new complete line.
 *
 * Implemented with polling (not fs.watch) because appends from a separate
 * process are flaky to observe via inotify on some filesystems; a 250ms poll
 * is plenty for a human tailing a trace. Returns a stop function.
 */
export function followTraceFile(
  filePath: string,
  onEvent: (event: TraceEvent) => void,
  pollMs = 250,
): () => void {
  let offset = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
  let partial = "";

  const timer = setInterval(() => {
    if (!fs.existsSync(filePath)) return;
    const size = fs.statSync(filePath).size;
    if (size <= offset) return;

    const stream = fs.createReadStream(filePath, { start: offset, end: size - 1, encoding: "utf8" });
    let chunkData = "";
    stream.on("data", (chunk) => {
      chunkData += chunk;
    });
    stream.on("end", () => {
      offset = size;
      partial += chunkData;
      const lines = partial.split("\n");
      partial = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === "") continue;
        try {
          onEvent(JSON.parse(trimmed) as TraceEvent);
        } catch {
          // A malformed line while following is reported once, loudly.
          throw new Error(`Malformed trace line while following: ${trimmed.slice(0, 120)}`);
        }
      }
    });
  }, pollMs);

  return () => clearInterval(timer);
}
