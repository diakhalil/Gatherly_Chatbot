from __future__ import annotations

import json
from typing import Any

from langchain_core.messages import ToolMessage

from agent.mcp.client import create_mcp_client

import logging

logger = logging.getLogger("gatherly.agent-a")

def _load_json_text(text: str) -> Any:
    stripped = text.strip()
    if not stripped:
        return None
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        return {"raw": text}


def _structured_content_from_artifact(artifact: Any) -> Any:
    if isinstance(artifact, dict):
        structured = artifact.get("structured_content")
        if structured is not None:
            return structured
    return None


def _unwrap_mcp_payload(value: Any) -> Any:
    if isinstance(value, dict):
        nested = _structured_content_from_artifact(value)
        if nested is not None and nested is not value:
            return _unwrap_mcp_payload(nested)

        result = value.get("result")
        if result is not None and len(value) == 1:
            return result

    return value


def _coerce_mcp_dict(value: Any) -> dict:
    value = _unwrap_mcp_payload(value)
    return value if isinstance(value, dict) else {}


def decode_mcp_result(result: Any) -> Any:
    if isinstance(result, ToolMessage):
        if result.status == "error":
            return None

        structured = _structured_content_from_artifact(result.artifact)
        if structured is not None:
            return _unwrap_mcp_payload(structured)

        if isinstance(result.content, str):
            parsed = _load_json_text(result.content)
            return _unwrap_mcp_payload(parsed)

        return result.content

    if isinstance(result, str):
        parsed = _load_json_text(result)
        return _unwrap_mcp_payload(parsed)

    return result


class GatherlyMCPClient:
    """Shared access to Gatherly MCP tools (weather + routing)."""

    def __init__(self):
        self._client = create_mcp_client()
        self._tools = None

    async def _get_tool(self, name: str):
        if self._tools is None:
            self._tools = {
                tool.name: tool
                for tool in await self._client.get_tools()
            }

        if name not in self._tools:
            raise RuntimeError(f"MCP tool is unavailable: {name}")

        return self._tools[name]

    async def _invoke_tool(self, name: str, arguments: dict) -> Any:
        logger.info("MCP | %s | call | %s", name, arguments)
        tool = await self._get_tool(name)
        try:
            result = await tool.ainvoke({
                "type": "tool_call",
                "id": f"gatherly-{name}",
                "name": name,
                "args": arguments,
            })
        except Exception as e:
            logger.error("MCP | %s | error | %s", name, e)
            raise
        if isinstance(result, ToolMessage) and result.status == "error":
            logger.warning("MCP | %s | tool_error | %s", name, result.content)
        else:
            logger.info("MCP | %s | ok", name)
        return result

    async def check_weather(
        self,
        latitude: float,
        longitude: float,
        event_date: str,
    ) -> dict:
        result = await self._invoke_tool("check_event_weather", {
            "latitude": latitude,
            "longitude": longitude,
            "event_date": event_date,
        })
        return _coerce_mcp_dict(decode_mcp_result(result))

    async def calculate_route(
        self,
        origin_latitude: float,
        origin_longitude: float,
        destination_latitude: float,
        destination_longitude: float,
        travel_mode: str = "driving",
    ) -> dict:
        result = await self._invoke_tool("calculate_event_route", {
            "origin_latitude": origin_latitude,
            "origin_longitude": origin_longitude,
            "destination_latitude": destination_latitude,
            "destination_longitude": destination_longitude,
            "travel_mode": travel_mode,
        })
        return _coerce_mcp_dict(decode_mcp_result(result))


    async def render_visualization(
        self,
        markdown: str,
        chart: dict | None = None,
        mermaid: str | None = None,
    ) -> dict:
        args: dict[str, Any] = {"markdown": markdown}
        if chart is not None:
            args["chart"] = chart
        if mermaid is not None:
            args["mermaid"] = mermaid
        result = await self._invoke_tool("render_visualization", args)
        return _coerce_mcp_dict(decode_mcp_result(result))
