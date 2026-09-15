"""Kohala tool SDK. Uses the loopback runtime locally and hosted."""

import json
import os
import urllib.request


class KohalaToolError(Exception):
    def __init__(self, code, message):
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message


def _rpc(tool, args):
    rpc_url = os.environ.get("KOHALA_RPC_URL")
    if not rpc_url:
        raise KohalaToolError("NO_RUNTIME", "KOHALA_RPC_URL is not set. Run via `kohala run <agent> --local`.")
    request = urllib.request.Request(
        rpc_url,
        data=json.dumps({"tool": tool, "args": args}).encode("utf-8"),
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
    return _rpc("s3.put", {"key": key, "body": body, **({"category": category} if category is not None else {})})


def s3_get(key_or_id):
    return _rpc("s3.get", {"keyOrId": key_or_id})


def s3_list(prefix=None, limit=None):
    return _rpc("s3.list", {**({"prefix": prefix} if prefix is not None else {}), **({"limit": limit} if limit is not None else {})})


def s3_delete(key_or_id):
    return _rpc("s3.delete", {"keyOrId": key_or_id})


def http_post_json(url, body, headers=None):
    return _rpc("http.post_json", {"url": url, "body": body, **({"headers": headers} if headers is not None else {})})


def llm_complete(prompt, model=None):
    return _rpc("llm.complete", {"prompt": prompt, **({"model": model} if model is not None else {})})


def notify_send(channel, message):
    return _rpc("notify.send", {"channel": channel, "message": message})


def metrics_record(name, value, tags=None):
    return _rpc("metrics.record", {"name": name, "value": value, **({"tags": tags} if tags is not None else {})})


def run_context():
    return {
        "agent": os.environ.get("KOHALA_AGENT", ""),
        "run_id": os.environ.get("KOHALA_RUN_ID", ""),
        "repair_attempt": int(os.environ.get("KOHALA_REPAIR_ATTEMPT", "0")),
        "validator_feedback": os.environ.get("KOHALA_VALIDATOR_FEEDBACK", ""),
    }