from __future__ import annotations

import json
import re

from agent.llm.ai_model import llm
from agent.nodes.admin.event_readiness.tools import build_readiness_tools
from agent.state.agent_state import AgentState
from agent.utils.tool_loop import run_tool_loop


def _extract_event_id(task: str) -> int | None:
    prompt = f"""
You extract the Gatherly event ID required for an Event Readiness check.

Return exactly one JSON object:
{{
  "event_id": 27
}}

If no event ID is provided, return:
{{
  "event_id": null
}}

User request:
{task}
"""

    raw = llm.invoke(prompt).text.strip()

    try:
        parsed = json.loads(raw)
        event_id = parsed.get("event_id")

        if event_id is not None:
            event_id = int(event_id)

            if event_id > 0:
                return event_id

    except (
        json.JSONDecodeError,
        TypeError,
        ValueError,
        AttributeError,
    ):
        pass

    match = re.search(
        r"\bevent(?:\s+id)?\s*#?\s*(\d+)\b",
        task,
        flags=re.IGNORECASE,
    )

    return int(match.group(1)) if match else None


def _format_readiness_response(result: dict) -> str:
    """Plain-text fallback when MCP visualization is unavailable."""
    score = result["score"]
    level = result["level"]

    lines = [
        (
            f"Event {result['event_id']} readiness: "
            f"{score}/100 ({level.replace('_', ' ')})."
        )
    ]

    risks = result.get("risks", [])

    if risks:
        lines.append(
            "\nRisks:\n"
            + "\n".join(f"- {risk}" for risk in risks)
        )
    else:
        lines.append("\nNo significant readiness risks were detected.")

    recommendations = result.get("recommendations", [])

    if recommendations:
        lines.append(
            "\nRecommendations:\n"
            + "\n".join(
                f"- {recommendation}"
                for recommendation in recommendations
            )
        )

    return "\n".join(lines)


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


async def event_readiness_agent(state: AgentState) -> dict:
    task = state["remaining_task"] or state["message"]
    event_id = _resolve_event_id(state, task)
    artifacts = dict(state.get("artifacts") or {})

    if state["role"] != "admin":
        response = (
            "Only administrators can run a complete "
            "event-readiness assessment."
        )
    elif not event_id:
        response = (
            "Please specify the event ID for the readiness assessment."
        )
    else:
        session: dict = {}
        tools = build_readiness_tools(
                session,
                state["role"],
                state["user_id"],
            )
        system_prompt = f"""
You are the Event Readiness specialist for Gatherly administrators.

Never invent SQL, weather, staffing, or logistics facts. Use only your tools.

Tools (ONLY these three — do not call any other tool names):
- load_readiness_context(event_id, scope): always first. scope = full / weather / staffing / logistics.
  Staffing and logistics analysis run inside load for the matching scope.
- check_weather_readiness: MCP weather check. Requires load with scope weather or full first.
- render_readiness_visualization(markdown, mermaid=""): scores automatically, then renders. YOU write the admin answer. No chart.

Style:
- Keep answers SHORT and concise, still informative. No long paragraphs.
- Prefer markdown TABLES for Overview, Weather, Staffing, Logistics, and Deductions.
- Use short bullet lists only for Risks and Recommendations (max 5 each).

Complete readiness workflow:
load_readiness_context(event_id, scope="full") -> check_weather_readiness → render_readiness_visualization.
Do NOT call score_event_readiness, check_staffing_readiness, or check_logistics_readiness — they do not exist.

For complete assessments, markdown MUST include these sections (use tables):
1) Overview: score/100, level
2) Weather: forecast numbers + venue_setting + one short line on setting impact
3) Staffing: required/assigned/shortage, leader, issues only if any
4) Logistics: capacity vs guests, accessibility, parking/transport, clothing if relevant
5) Deductions: category, points, reason
6) Risks, Recommendations: short bullets from the reports

Mermaid:
- For complete assessments you MUST pass a small mermaid flowchart, for example:
  flowchart TD
    S["Score X/100"] --> W["Weather"]
    S --> H["Staffing"]
    S --> L["Logistics"]
  Use real score/level from the session. Do not leave mermaid empty.

Partial asks:
- Weather-only → load_readiness_context(scope="weather") → check_weather_readiness (no render unless user wants a full write-up)
- Staffing-only → load_readiness_context(scope="staffing") only
- Logistics-only → load_readiness_context(scope="logistics") only

Do not inspect past team-leader reviews or classify debriefs.
Those belong to the post-event debrief specialist.

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
            response = (viz.get("markdown") or "").strip()
            artifacts["visualization"] = {
                "markdown": viz.get("markdown"),
                "image_url": None,
            }
        else:
            readiness = session.get("readiness_result")
            if readiness and readiness.get("status") == "success":
                artifacts["readiness"] = readiness
                if readiness.get("score") is not None:
                    response = _format_readiness_response(readiness)
            elif session.get("weather_report") and not session.get(
                "staffing_report"
            ):
                weather = session["weather_report"]
                risks = weather.get("risks") or []
                response = (
                    f"Weather readiness for event {event_id}: "
                    f"{weather.get('status', 'unknown')}."
                )
                if risks:
                    response += "\n\nRisks:\n" + "\n".join(
                        f"- {risk}" for risk in risks
                    )

        readiness = session.get("readiness_result")
        if readiness and readiness.get("status") == "success":
            artifacts["readiness"] = readiness

    return {
        "response": response,
        "selected_agent": "event_readiness_agent",
        "specialist_results": state["specialist_results"] + [response],
        "completed_agents": state["completed_agents"]
        + ["event_readiness_agent"],
        "remaining_task": "",
        "artifacts": artifacts,
    }
    
