from __future__ import annotations

import re

from agent.llm.ai_model import llm
from agent.nodes.client.event_explorer.tools import (
    build_client_explorer_tools,
)
from agent.state.agent_state import AgentState
from agent.utils.tool_loop import run_tool_loop


def _extract_event_id(task: str) -> int | None:
    match = re.search(
        r"\bevent(?:\s+id)?\s*#?\s*(\d+)\b",
        task,
        flags=re.IGNORECASE,
    )
    return int(match.group(1)) if match else None


def _resolve_event_id(state: AgentState, task: str) -> int | None:
    preferred = state.get("preferred_event_id")
    if preferred:
        try:
            value = int(preferred)
            if value > 0:
                return value
        except (TypeError, ValueError):
            pass
    return _extract_event_id(task)


def _format_explorer_response(result: dict) -> str:
    """Plain-text fallback when MCP visualization is unavailable."""
    best = result.get("best_match") or {}
    current = result.get("current_venue") or {}

    lines = [
        f"Venue comparison for event {result['event_id']}:",
        "",
        "Best match:",
        f"- Venue: {best.get('name')}",
        f"- Score: {best.get('final_score')}/100",
        f"- Capacity: {best.get('capacity')}",
        (
            "- Accessible: "
            f"{'Yes' if best.get('wheelchair_accessible') else 'No'}"
        ),
        (
            "- Parking: "
            f"{'Yes' if best.get('parking_available') else 'No'}"
        ),
    ]

    weather = best.get("weather_report", {}).get("weather", {})
    if weather.get("status") == "success":
        lines.extend([
            "",
            "Weather:",
            (
                f"- Temperature: "
                f"{weather.get('temperature_min_c')}–"
                f"{weather.get('temperature_max_c')}°C"
            ),
            f"- Rain: {weather.get('precipitation_mm')} mm",
        ])

    if current:
        lines.extend([
            "",
            "Current venue:",
            f"- {current.get('name')}: {current.get('final_score')}/100",
        ])
        for risk in current.get("risks", []):
            lines.append(f"- Risk: {risk}")

    lines.extend([
        "",
        "Venue locations use database coordinates.",
    ])
    return "\n".join(lines)


async def client_event_explorer_agent(state: AgentState) -> dict:
    task = state["remaining_task"] or state["message"]
    event_id = _resolve_event_id(state, task)
    artifacts = dict(state.get("artifacts") or {})

    if state["role"] != "client":
        response = "Client Event Explorer is available only to clients."
    elif not event_id:
        response = "Please specify your event ID."
    else:
        session: dict = {}
        tools = build_client_explorer_tools(
            session,
            user_id=state["user_id"],
            origin_latitude=state.get("origin_latitude"),
            origin_longitude=state.get("origin_longitude"),
        )
        has_location = (
            state.get("origin_latitude") is not None
            and state.get("origin_longitude") is not None
        )
        

        system_prompt = f"""
You are the Client Event Explorer specialist for Gatherly clients.

Never invent venue, weather, or route facts. Use only your tools.

Tools (ONLY these four):
- load_client_event_context(event_id, scope): always first.
  scope = full / suitability / weather / routes.
  SQL and venue scoring run inside load.
- compare_weather: MCP weather for top venues.
- compare_routes: MCP routes. Location available: {has_location}.
- render_explorer_visualization(markdown, chart): scores and renders your answer.
  For full compare, chart is REQUIRED (never null / never omit).

Do NOT call match_venues or assemble_venue_comparison.

Style:
- Short and concise. Prefer tables for Best match, Ranked venues, Weather, Route.
- Short bullet lists for risks only (max 5).

Workflows:
- Full compare -> load(scope="full") -> compare_weather -> compare_routes (if location) -> render
- Suitability only -> load(scope="suitability") only
- Weather only -> load(scope="weather") -> compare_weather
- Routes only -> load(scope="routes") -> compare_routes (if location)

Use render only when the user wants a full written comparison or chart.
For full compare, markdown should cover: best match, ranked venues, weather (if ran),
route (if ran), current venue (if any). bar chart from real final_score values.

Default event ID: {event_id}
Never invent numbers or {{{{...}}}} placeholders.
Do not mention tool names in the final answer.
"""

        response = await run_tool_loop(
            llm=llm,
            system_prompt=system_prompt,
            user_message=task,
            tools=tools,
        )

        viz = session.get("visualization")
        if viz and viz.get("status") == "success":
            parts = [viz.get("markdown") or ""]
            if viz.get("image_url"):
                parts.append(f"\n\n![chart]({viz['image_url']})")
            response = "\n".join(parts).strip()
            artifacts["visualization"] = {
                "markdown": viz.get("markdown"),
                "image_url": viz.get("image_url"),
            }
        else:
            explorer = session.get("explorer")
            if explorer and explorer.get("status") == "success":
                artifacts["explorer"] = explorer
                response = _format_explorer_response(explorer)

        explorer = session.get("explorer")
        if explorer and explorer.get("status") == "success":
            artifacts["explorer"] = explorer

    return {
        "response": response,
        "selected_agent": "client_event_explorer_agent",
        "specialist_results": state["specialist_results"] + [response],
        "completed_agents": state["completed_agents"]
        + ["client_event_explorer_agent"],
        "remaining_task": "",
        "artifacts": artifacts,
    }
    