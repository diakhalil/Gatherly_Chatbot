"""Shared ReAct-style tool loop for workflow specialists."""

from __future__ import annotations

import json
from typing import Any

from langchain_core.messages import (
    AIMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)

import logging
logger = logging.getLogger("gatherly.agent-a")

MAX_TOOL_ROUNDS = 10


def _tool_result_text(result: Any) -> str:
    if isinstance(result, str):
        return result
    try:
        return json.dumps(result, default=str)
    except TypeError:
        return str(result)

def _message_text(content: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content.strip()
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, str):
                parts.append(item)
            elif isinstance(item, dict) and item.get("text"):
                parts.append(str(item["text"]))
            elif hasattr(item, "text"):
                parts.append(str(item.text))
            else:
                parts.append(str(item))
        return "\n".join(parts).strip()
    return str(content).strip()

async def run_tool_loop(
    *,
    llm,
    system_prompt: str,
    user_message: str,
    tools: list,
) -> str:
    """
    Run model → tool calls → observations until a final text answer
    or MAX_TOOL_ROUNDS is hit (then return a graceful partial answer).
    """
    if not tools:
        response = await llm.ainvoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_message),
        ])
        return _message_text(response.content)

    llm_with_tools = llm.bind_tools(tools)
    tool_map = {tool.name: tool for tool in tools}
    messages: list = [
        SystemMessage(content=system_prompt),
        HumanMessage(content=user_message),
    ]

    partial_notes: list[str] = []

    for round_index in range(MAX_TOOL_ROUNDS):
        response = await llm_with_tools.ainvoke(messages)
        messages.append(response)

        tool_calls = getattr(response, "tool_calls", None) or []
        if not tool_calls:
            logger.info(
                "AGENT TOOL | round=%s | final answer (no more tools)",
                round_index + 1,
            )
            content = _message_text(response.content)
            if content:
                return content
            if partial_notes:
                return (
                    "Here is what I gathered before finishing:\n"
                    + "\n".join(partial_notes[-3:])
                )
            return "I could not produce an answer for this request."

        for tool_call in tool_calls:
            name = tool_call.get("name", "")
            args = tool_call.get("args") or {}
            call_id = tool_call.get("id") or f"{name}-{round_index}"
            logger.info(
                "AGENT TOOL | round=%s | call | %s | args=%s",
                round_index + 1,
                name,
                args,
            )
            tool = tool_map.get(name)

            if tool is None:
                logger.error(
                    "AGENT TOOL | round=%s | unknown tool | %s",
                    round_index + 1,
                    name,
                )
                observation = json.dumps({
                    "status": "error",
                    "message": f"Unknown tool: {name}",
                })
            else:
                try:
                    observation = _tool_result_text(
                        await tool.ainvoke(args)
                    )
                    
                except Exception as error:
                    logger.error(
                        "AGENT TOOL | round=%s | error | %s | %s",
                        round_index + 1,
                        name,
                        error,
                    )
                    observation = json.dumps({
                        "status": "error",
                        "message": str(error),
                    })

            if name == "run_sql":
                logger.info(
                    "AGENT TOOL | round=%s | back | run_sql | (result omitted)",
                    round_index + 1,
                )
            else:
                logger.info(
                    "AGENT TOOL | round=%s | back | %s | result=%s",
                    round_index + 1,
                    name,
                    observation[:300],
                )

            partial_notes.append(f"{name}: {observation[:500]}")
            messages.append(
                ToolMessage(
                    content=observation,
                    tool_call_id=call_id,
                )
            )

    if isinstance(messages[-1], AIMessage) and messages[-1].content:
        logger.warning(
            "AGENT TOOL | round limit reached (%s)",
            MAX_TOOL_ROUNDS,
        )
        return (
            _message_text(messages[-1].content)
            + "\n\n(Tool round limit reached; this may be a partial answer.)"
        )

    return (
        "I reached the tool-call limit before finishing. "
        "Partial evidence:\n"
        + "\n".join(partial_notes[-5:])
    )
