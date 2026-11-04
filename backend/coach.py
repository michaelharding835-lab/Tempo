"""The AI coach: Claude with live access to the athlete's Garmin data.

Primary path: Claude's MCP connector calls this deployment's own /mcp endpoint, so
Claude reads the data through the MCP server. On localhost (where Anthropic can't
reach the server) or with COACH_MODE=local, the backend runs the same tools itself.
Both paths stream the same events to the app: tool, text, done, error.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Iterator
from urllib.parse import urlparse

from . import config, tools

MCP_BETA = "mcp-client-2025-11-20"

SYSTEM = """You are Tempo Coach, a sharp, warm endurance and HYROX coach inside a personal \
Garmin app. You can read the athlete's real Garmin data through tools — always check the \
data before answering questions about their body, training or recovery, and quote the \
actual numbers you used.

Style: lead with the answer in one or two sentences, then the evidence. Keep it short and \
scannable for a phone (short paragraphs or a few bullets, no tables, no headings). Use \
metric units and km paces like 4:45/km. Give concrete, specific training advice. You are \
not a doctor: for pain, illness or worrying symptoms, say so plainly and suggest seeing \
a professional.

Today is {today} (athlete's local date). {about}"""


def _event(kind: str, **data: Any) -> str:
    return json.dumps({"type": kind, **data}) + "\n"


def _public_mcp_url(request_base: str | None) -> str | None:
    base = config.PUBLIC_URL or request_base
    if not base:
        return None
    host = urlparse(base).hostname or ""
    if host in ("localhost", "127.0.0.1", "0.0.0.0") or host.endswith(".local") or not base.startswith("https://"):
        return None
    return base.rstrip("/") + "/mcp"


def _messages(history: list[dict[str, Any]]) -> list[dict[str, Any]]:
    msgs = []
    for m in history[-16:]:
        role = m.get("role")
        text = (m.get("content") or "").strip()
        if role in ("user", "assistant") and text:
            msgs.append({"role": role, "content": text})
    while msgs and msgs[0]["role"] != "user":
        msgs.pop(0)
    return msgs


def stream(history: list[dict[str, Any]], today: str | None, about: str | None,
           request_base: str | None) -> Iterator[str]:
    if not config.ANTHROPIC_API_KEY:
        yield _event("error", message="Add ANTHROPIC_API_KEY to the server's environment to use the coach.")
        return
    import anthropic

    client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)
    system = SYSTEM.format(today=today or datetime.now().date().isoformat(),
                           about=f"About the athlete: {about.strip()}" if about and about.strip() else "")
    messages = _messages(history)
    if not messages:
        yield _event("error", message="Ask a question to start.")
        return
    mcp_url = _public_mcp_url(request_base) if config.COACH_MODE != "local" else None
    try:
        if mcp_url and config.APP_ACCESS_KEY:
            yield from _via_mcp(client, system, messages, mcp_url)
        else:
            yield from _via_local_tools(client, system, messages)
    except Exception as exc:  # noqa: BLE001
        yield _event("error", message=f"The coach couldn't answer: {str(exc)[:240]}")
        return
    yield _event("done")


TOOL_LABELS = {
    "get_daily_summary": "Read today's metrics", "list_activities": "Looked through activities",
    "get_activity": "Opened an activity", "get_training_status": "Checked training status",
    "get_trend": "Looked at a trend", "get_hyrox_history": "Reviewed HYROX history",
    "get_muscle_load": "Checked muscles this week",
    "get_profile": "Checked profile",
}


def _via_mcp(client: Any, system: str, messages: list[dict[str, Any]], mcp_url: str) -> Iterator[str]:
    with client.beta.messages.stream(
        model=config.COACH_MODEL,
        max_tokens=2000,
        system=system,
        messages=messages,
        mcp_servers=[{"type": "url", "url": mcp_url, "name": "garmin",
                      "authorization_token": config.APP_ACCESS_KEY}],
        tools=[{"type": "mcp_toolset", "mcp_server_name": "garmin"}],
        betas=[MCP_BETA],
    ) as s:
        for event in s:
            etype = getattr(event, "type", None)
            if etype == "content_block_start":
                block = event.content_block
                if getattr(block, "type", None) == "mcp_tool_use":
                    yield _event("tool", name=block.name, label=TOOL_LABELS.get(block.name, block.name))
            elif etype == "content_block_delta":
                delta = event.delta
                if getattr(delta, "type", None) == "text_delta":
                    yield _event("text", text=delta.text)


def _via_local_tools(client: Any, system: str, messages: list[dict[str, Any]]) -> Iterator[str]:
    convo: list[dict[str, Any]] = list(messages)
    defs = tools.claude_tool_defs()
    for _ in range(8):
        resp = client.messages.create(model=config.COACH_MODEL, max_tokens=2000, system=system,
                                      messages=convo, tools=defs)
        tool_results = []
        for block in resp.content:
            if block.type == "text" and block.text:
                yield _event("text", text=block.text)
            elif block.type == "tool_use":
                yield _event("tool", name=block.name, label=TOOL_LABELS.get(block.name, block.name))
                tool_results.append({"type": "tool_result", "tool_use_id": block.id,
                                     "content": tools.run_tool(block.name, block.input)})
        if resp.stop_reason != "tool_use" or not tool_results:
            return
        convo.append({"role": "assistant", "content": [b.model_dump(exclude_none=True) for b in resp.content]})
        convo.append({"role": "user", "content": tool_results})
