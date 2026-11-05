#!/usr/bin/env python3
"""Opt-in MiniMax M3.1 Flash SSE/tool-call experiment; no dependencies.

Only sends the synthetic prompt, tool schema and temporary README in this file.
The API key is read from MINIMAX_API_KEY, never printed or recorded.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import tempfile
import urllib.error
import urllib.request
from urllib.parse import urlsplit


def request(messages, tools, key, base):
    body = {
        "model": "MiniMax-M3.1-Flash",
        "messages": messages,
        "tools": tools,
        "stream": True,
        "stream_options": {"include_usage": True},
        "reasoning_effort": "low",
        "max_completion_tokens": 2048,
    }
    req = urllib.request.Request(
        base.rstrip("/") + "/chat/completions",
        data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
        method="POST",
    )
    assistant = {"role": "assistant", "content": ""}
    calls = {}
    events = []
    usage = None
    finish = None
    model_reported = None
    try:
        with urllib.request.urlopen(req, timeout=90) as response:
            for line in response:
                line = line.decode("utf-8").strip()
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if data == "[DONE]":
                    break
                chunk = json.loads(data)
                if chunk.get("error"):
                    raise RuntimeError("API returned an error event")
                if chunk.get("model"):
                    model_reported = chunk["model"]
                if chunk.get("usage"):
                    usage = chunk["usage"]
                for choice in chunk.get("choices", []):
                    delta = choice.get("delta") or {}
                    assistant["content"] += delta.get("content") or ""
                    if delta.get("reasoning_content") is not None:
                        assistant["reasoning_content"] = assistant.get("reasoning_content", "") + delta["reasoning_content"]
                    for part in delta.get("tool_calls") or []:
                        index = part["index"]
                        call = calls.setdefault(index, {"id": "", "type": "function", "function": {"name": "", "arguments": ""}})
                        if part.get("id"):
                            call["id"] += part["id"]
                        fn = part.get("function") or {}
                        call["function"]["name"] += fn.get("name") or ""
                        call["function"]["arguments"] += fn.get("arguments") or ""
                    # Preserve actual protocol deltas, excluding the model's reasoning text.
                    visible = {k: v for k, v in delta.items() if k != "reasoning_content"}
                    if visible:
                        events.append({"delta": visible})
                    if choice.get("finish_reason"):
                        finish = choice["finish_reason"]
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")[:500].replace(key, "[redacted]")
        raise RuntimeError(f"MiniMax HTTP {error.code}: {detail}") from error
    if calls:
        assistant["tool_calls"] = [calls[i] for i in sorted(calls)]
    if not finish:
        raise RuntimeError("stream ended without finish_reason")
    return assistant, {"model_reported": model_reported, "finish_reason": finish, "usage": usage, "visible_sse_deltas": events}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--record", type=Path, help="write a sanitized result, with reasoning omitted")
    args = parser.parse_args()
    key = os.environ.get("MINIMAX_API_KEY")
    if not key:
        raise SystemExit("Set MINIMAX_API_KEY to run this opt-in live experiment.")
    base = os.environ.get("MINIMAX_BASE_URL", "https://api.minimax.io/v1")
    tools = [{"type": "function", "function": {"name": "read_file", "description": "Read README.md from the temporary demonstration project.", "parameters": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]}}}]
    messages = [
        {"role": "system", "content": "You are a coding assistant. Use read_file to inspect README.md before answering. Do not invent its content."},
        {"role": "user", "content": "Read README.md and say what this demo project does."},
    ]
    first, first_trace = request(messages, tools, key, base)
    calls = first.get("tool_calls", [])
    if first_trace["finish_reason"] != "tool_calls" or len(calls) != 1:
        raise RuntimeError("expected exactly one tool call; inspect the response, then retry")
    call = calls[0]
    if not call["id"] or call["function"]["name"] != "read_file":
        raise RuntimeError("unexpected tool call or missing provider ID")
    tool_args = json.loads(call["function"]["arguments"])
    if tool_args != {"path": "README.md"}:
        raise RuntimeError("unexpected tool arguments")
    with tempfile.TemporaryDirectory(prefix="minimax-course-") as temp:
        file = Path(temp) / "README.md"
        file.write_text("# Demo\nThis project counts apples.\n", encoding="utf-8")
        result = file.read_text(encoding="utf-8")
    tool_message = {"role": "tool", "tool_call_id": call["id"], "content": result}
    # Do not drop reasoning_content: MiniMax requires it on tool-call history.
    second, second_trace = request([*messages, first, tool_message], tools, key, base)
    if second_trace["finish_reason"] != "stop" or not second["content"].strip():
        raise RuntimeError("second response did not produce a final answer")
    reasoning = first.get("reasoning_content", "")
    endpoint = urlsplit(base)
    official = endpoint.scheme == "https" and endpoint.hostname in {"api.minimax.io", "api.minimaxi.com"}
    report = {
        "kind": "real-api-sanitized-observation" if official else "custom-endpoint-observation",
        "captured_at_utc": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "model_requested": "MiniMax-M3.1-Flash",
        "endpoint": base.rstrip("/") + "/chat/completions",
        "source": "MiniMax API; synthetic prompt and temporary file" if official else "custom endpoint; not verified as the MiniMax service",
        "first_response": {"role": first["role"], "content": first["content"], "tool_calls": calls, "reasoning_content_omitted": True, "reasoning_chars": len(reasoning), "reasoning_sha256": hashlib.sha256(reasoning.encode()).hexdigest(), **first_trace},
        "tool_result_sent": tool_message,
        "second_response": {"content": second["content"], "reasoning_content_omitted": True, **second_trace},
        "checks": {"tool_id_copied_from_response": tool_message["tool_call_id"] == call["id"], "reasoning_returned_unchanged": True if reasoning else None, "final_answer_received": bool(second["content"].strip())},
    }
    output = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.record:
        args.record.parent.mkdir(parents=True, exist_ok=True)
        args.record.write_text(output, encoding="utf-8")
    print(output, end="")


if __name__ == "__main__":
    main()
