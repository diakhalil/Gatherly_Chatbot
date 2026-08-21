from __future__ import annotations

import re

from agent.llm.ai_model import llm
from agent.nodes.host.event_briefing.tools import build_host_briefing_tools
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
        except (TypeError, ValueError): #if conversion failed, dont crash
            pass
    return _extract_event_id(task)



async def host_event_briefing_agent(state: AgentState) -> dict:
    task = state["remaining_task"] or state["message"]
    event_id = _resolve_event_id(state, task)
    # extra structured data that the agents attach to the conversation state
    # A dict of machine-friendly extras (charts, JSON reports, download links, etc.)
    artifacts = dict(state.get("artifacts") or {})

    if state["role"] != "host":
        response = "Host Event Briefing is available only to hosts."
    elif not event_id:
        response = "Please specify the assigned event ID."
    else:
        session: dict = {}
        tools = build_host_briefing_tools(
            session,
            user_id=state["user_id"],
            role=state["role"],
            origin_latitude=state.get("origin_latitude"),
            origin_longitude=state.get("origin_longitude"),
        )
        has_location = (
            state.get("origin_latitude") is not None
            and state.get("origin_longitude") is not None
        )


        system_prompt = f"""
        You are the Host Event Briefing specialist for Gatherly hosts.

        Never invent SQL, weather, route, or team facts. Use only your tools.

        Tools:
        - fetch_briefing_sql(event_id, labels=...): EXACTLY ONCE per turn. Don't call it again.
        - check_event_weather, calculate_live_route, assemble_host_briefing,
        render_briefing_visualization

        Browser location available: {has_location}.
        - If true: NEVER ask the user for latitude/longitude. Call calculate_live_route;
        origin is already provided by the browser.
        - If false: tell them to allow browser location and send the message again.
        NEVER ask them to type coordinates.

        Visualization rules (creative, data-grounded):
        - Call render_briefing_visualization only after assemble_host_briefing for a complete briefing.
        - markdown MUST include Weather near the top when weather status is success.
        - markdown MUST include each host photo when image_url is present,
          on the SAME line as the name/role:
          - ![Full Name](image_url) **Full Name** — role
        - Choose at most ONE extra visual:
        - Live route + times available -> mermaid flowchart Leave -> Arrive -> Start
            (use exact times from briefing; in Mermaid replace ":" with "." in times)
        - Several risks / readiness signals -> chart_json radar or bar with real scores/values
        - Large team focus -> chart_json doughnut/pie of roles, still keep photo markdown
        - Never invent numbers, names, times, or image URLs.
        - For maps, paste the exact route.map_url string from the briefing. Never write {{route.map_url}} or any {{...}} placeholders.
        - Always write schedule times as full YYYY-MM-DD HH:MM from the briefing
          (e.g. 2026-03-03 15:44), never time-only like 15:44.

       Workflow:
        - Full briefing: ONE fetch with default labels (all 7) -> check_event_weather
        -> calculate_live_route -> assemble_host_briefing -> render_briefing_visualization.
        Do NOT fetch again for team/host/photos; team is already in the first fetch.
        - Partial asks only: ONE fetch with minimal labels, then ONLY the matching tool.
        Do NOT call assemble or render unless the user asked for a full briefing.
        - weather -> labels="assignment,event,venue" -> check_event_weather
        - outfit -> labels="assignment,event,host,clothing"
        - route -> labels="assignment,event,venue" -> calculate_live_route
        - Default event ID: {event_id}

        - Route: always label OSRM vs Google Maps.
        Show exact travel_minutes and distance_km from OSRM.
        Leave-by is OSRM only (no buffer). Tell the host to check Google Maps
        for live traffic because leave-by does not include a traffic buffer.
        Paste map_url as a bare URL. Never invent minutes or {{...}} placeholders.
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
            #  artifacts = LLM markdown + optional chart URL, stored separately from response
            artifacts["visualization"] = {
                "markdown": viz.get("markdown"),
                "image_url": viz.get("image_url"),
            }

    return {
        "response": response,
        "selected_agent": "host_event_briefing_agent",
        "specialist_results": state["specialist_results"] + [response],
        "completed_agents": state["completed_agents"]
        + ["host_event_briefing_agent"],
        "remaining_task": "",
        "artifacts": artifacts,
    }
