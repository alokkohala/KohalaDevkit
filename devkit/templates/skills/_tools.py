"""Kohala tool SDK (local twin).

Your skill script talks to the Kohala runtime through these helpers. Locally
they call the emulator over a loopback RPC endpoint; on the hosted platform
the same functions talk to the real runtime. Your script does not change.

Uses only the Python standard library — no pip installs needed.

Available tools (each must also be listed in kohala.json -> toolAllowlist):

    s3_put(key, body, category=None)   store text in agent memory
    s3_get(key_or_id)                  fetch a memory asset
    s3_list(prefix=None, limit=None)   list active memory assets
    s3_delete(key_or_id)               remove + deactivate an asset
    http_post_json(url, body, headers=None)  POST JSON to an external API
    llm_complete(prompt, model=None)   complete text with YOUR OWN LLM key
    notify_send(channel, message)      send a notification (trace, locally)
    metrics_record(name, value, tags=None)   record a metric (trace, locally)

Every helper raises KohalaToolError on failure — including TOOL_DENIED when
the tool is not in your allowlist, and PER_RUN_TOKEN_CAP when an LLM call
would cross your per-run token cap. Errors are loud on purpose.
"""

import json
import os
import urllib.request


class KohalaToolError(Exception):
    """A tool call failed. `code` is the platform's machine-readable code."""

    def __init__(self, code, message):
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message


def _rpc(tool, args):
    rpc_url = os.environ.get("KOHALA_RPC_URL")
    if not rpc_url:
        raise KohalaToolError(
            "NO_RUNTIME",
            "KOHALA_RPC_URL is not set. Run this script via `kohala run <agent> --local`, "
            "not directly with python.",
        )
    payload = json.dumps({"tool": tool, "args": args}).encode("utf-8")
    request = urllib.request.Request(
        rpc_url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request) as response:
        body = json.loads(response.read().decode("utf-8"))
    if not body.get("ok"):
        error = body.get("error") or {}
        raise KohalaToolError(error.get("code", "UNKNOWN"), error.get("message", "tool call failed"))
    return body.get("result")


def s3_put(key, body, category=None):
    args = {"key": key, "body": body}
    if category is not None:
        args["category"] = category
    return _rpc("s3.put", args)


def s3_get(key_or_id):
    return _rpc("s3.get", {"keyOrId": key_or_id})


def s3_list(prefix=None, limit=None):
    args = {}
    if prefix is not None:
        args["prefix"] = prefix
    if limit is not None:
        args["limit"] = limit
    return _rpc("s3.list", args)


def s3_delete(key_or_id):
    return _rpc("s3.delete", {"keyOrId": key_or_id})


def http_post_json(url, body, headers=None):
    args = {"url": url, "body": body}
    if headers is not None:
        args["headers"] = headers
    return _rpc("http.post_json", args)


def llm_complete(prompt, model=None):
    args = {"prompt": prompt}
    if model is not None:
        args["model"] = model
    return _rpc("llm.complete", args)


def notify_send(channel, message):
    return _rpc("notify.send", {"channel": channel, "message": message})


def metrics_record(name, value, tags=None):
    args = {"name": name, "value": value}
    if tags is not None:
        args["tags"] = tags
    return _rpc("metrics.record", args)


def run_context():
    """Info about the current shift, including repair-loop state.

    Returns a dict with:
      agent            the agent name
      run_id           unique id of this shift
      repair_attempt   0 on the first try, 1..2 on repair attempts
      validator_feedback  why validators failed last attempt (empty on first try)
    """
    return {
        "agent": os.environ.get("KOHALA_AGENT", ""),
        "run_id": os.environ.get("KOHALA_RUN_ID", ""),
        "repair_attempt": int(os.environ.get("KOHALA_REPAIR_ATTEMPT", "0")),
        "validator_feedback": os.environ.get("KOHALA_VALIDATOR_FEEDBACK", ""),
    }
