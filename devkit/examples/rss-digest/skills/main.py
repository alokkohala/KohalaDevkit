"""rss-digest — summarize headlines with YOUR OWN LLM key.

Demonstrates: llm.complete (requires ANTHROPIC_API_KEY or GEMINI_API_KEY in
your environment — the devkit never mocks completions), plus the per-run
token cap: if the call would cross caps.perRunTokens it fails loudly with
PER_RUN_TOKEN_CAP.
"""

import sys
import urllib.request
import xml.etree.ElementTree as ET

from _tools import s3_put, llm_complete, notify_send, KohalaToolError

FEED_URL = "https://hnrss.org/frontpage"


def fetch_titles(limit=8):
    with urllib.request.urlopen(FEED_URL, timeout=30) as response:
        tree = ET.parse(response)
    titles = [item.findtext("title") or "" for item in tree.iter("item")]
    return [title for title in titles if title][:limit]


def main():
    titles = fetch_titles()
    if not titles:
        print("feed returned no items", file=sys.stderr)
        raise SystemExit(1)

    prompt = (
        "Summarize these headlines into a 3-sentence digest for a busy reader:\n- "
        + "\n- ".join(titles)
    )
    try:
        completion = llm_complete(prompt)
    except KohalaToolError as error:
        # NO_LLM_KEY or PER_RUN_TOKEN_CAP — both are loud by design.
        print(f"llm.complete failed: {error}", file=sys.stderr)
        raise SystemExit(1)

    digest = completion["text"].strip()
    s3_put("digest/latest", digest)
    notify_send("dev", "digest updated")
    print(digest)


if __name__ == "__main__":
    main()
