"""LangChain tools for the Host Event Briefing specialist."""

from __future__ import annotations

import json
import re
from typing import Any
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field
from agent.services.mcp_tools import GatherlyMCPClient
from agent.nodes.host.event_briefing.assignment import (analyze_host_assignment)
from agent.nodes.host.event_briefing.clothing import (analyze_host_clothing)
from agent.nodes.host.event_briefing.route import (analyze_host_route)
from agent.nodes.host.event_briefing.team import (build_safe_team_cards)
from agent.nodes.host.event_briefing.timeline import (build_host_timeline)
from agent.nodes.shared.weather import analyze_event_weather
from agent.utils.progress import emit_progress
from agent.nodes.shared.sql_agent import gatherly_sql_lookup
from agent.services.briefing_sql_adapter import build_briefing_context_from_sql


class EventIdArgs(BaseModel):
    event_id: int = Field(..., description="Assigned Gatherly event ID.")


class EmptyArgs(BaseModel):
    """Optional note so local models can satisfy empty tool schemas."""

    note: str = Field(
        default="",
        description="Optional short note; leave empty.",
    )

class VisualizationArgs(BaseModel):
    markdown: str = Field(
        ...,
        description=(
            "User-facing markdown for the host. Put Weather near the top when "
            "available. Include each teammate with a real photo when image_url "
            "exists, as ![Name](https://...). Use only facts from assemble_host_briefing. "
            "Write all schedule times as full YYYY-MM-DD HH:MM (never time-only)."
        ),
    )
    chart_json: str = Field(
        default="",
        description=(
            "Optional QuickChart JSON string only, e.g. "
            '{"type":"radar","title":"...","labels":["Weather","Route","Outfit","Team"],'
            '"datasets":[{"label":"Readiness","values":[80,70,90,85]}]}. '
            "Use only numbers from the briefing. Empty string to skip."
        ),
    )
    mermaid: str = Field(
        default="",
        description=(
            "Optional Mermaid source (flowchart/timeline). Prefer chart OR mermaid, "
            "not both. Empty string to skip. Never invent times — use briefing values."
        ),
    )

class FetchBriefingArgs(BaseModel):
    event_id: int = Field(..., description="Assigned Gatherly event ID.")
    labels: str = Field(
        default="assignment,event,host,venue,clothing,transport,team",
        description=(
            "Comma-separated datasets to load. "
            "Use a subset for partial asks (e.g. assignment,event for arrival only)."
        ),
    )

def _dumps(payload: Any) -> str:
    return json.dumps(payload, default=str)


def _briefing_date_prefix(briefing: dict) -> str | None:
    for source in (
        (briefing.get("timeline") or {}).get("starts_at"),
        (briefing.get("timeline") or {}).get("required_arrival"),
        (briefing.get("route") or {}).get("suggested_departure"),
        (briefing.get("route") or {}).get("required_arrival"),
    ):
        if not source:
            continue
        match = re.match(r"(\d{4}-\d{2}-\d{2})", str(source))
        if match:
            return match.group(1)
    return None


def _expand_clock_times_with_date(text: str, date_prefix: str) -> str:
    """Turn bare HH:MM into YYYY-MM-DD HH:MM using the event date."""
    if not text or not date_prefix:
        return text
    return re.sub(
        rf"(?<!\d{{4}}-\d{{2}}-\d{{2}} )"
        rf"(\b(?:[01]?\d|2[0-3]):[0-5]\d)\b"
        rf"(?!\s*(?:min|mins|minutes|km|km/h)\b)",
        rf"{date_prefix} \1",
        text,
    )


def _build_briefing_artifact(session: dict) -> dict | None:
    context = session.get("context") or {}
    if context.get("status") != "success":
        return None

    assignment = session.get("assignment") or {}
    timeline = session.get("timeline") or {}
    weather = session.get("weather") or {}
    route = session.get("route") or {
        "status": "location_required",
        "message": (
            "Share your current location to calculate "
            "a live route and departure time."
        ),
    }
    clothing = session.get("clothing") or {}
    team = session.get("team") or {}

    risks = list(dict.fromkeys(
        (weather.get("risks") or [])
        + (clothing.get("risks") or [])
    ))
    recommendations = list(dict.fromkeys(
        (weather.get("recommendations") or [])
        + (clothing.get("recommendations") or [])
    ))

    used = [
        name
        for name in (
            "assignment",
            "timeline",
            "weather",
            "route",
            "clothing",
            "team",
        )
        if session.get(name)
    ]

    return {
        "status": "success",
        "feature": "host_event_briefing",
        "event_id": session.get("event_id"),
        "host_id": session.get("user_id"),
        "source_count": context.get("source_count", 0),
        "assignment": assignment,
        "timeline": timeline,
        "weather": weather,
        "route": route,
        "clothing": clothing,
        "team": team,
        "risks": risks,
        "recommendations": recommendations,
        "checklist": assignment.get("checklist", []),
        "subagents": used,
    }


def build_host_briefing_tools(
    session: dict,
    *,
    user_id: int,
    role: str,
    origin_latitude: float | None,
    origin_longitude: float | None,
) -> list:
    session["user_id"] = user_id

    async def fetch_briefing_sql(event_id: int, labels: str = "assignment,event,host,venue,clothing,transport,team") -> str:
        """Load briefing data via shared SQL service. Call first."""

        if session.get("sql_fetch_done") and session.get("event_id") == event_id:
            return _dumps({
                "status": "success",
                "event_id": event_id,
                "cached": True,
                "message": "Briefing data and core analysis already loaded.",
            })
       
        label_list = [x.strip() for x in labels.split(",") if x.strip()]
        await emit_progress(
            "sql_context",
            "running",
            "Fetching briefing data from SQL",
            "host_event_briefing_agent",
        )

        hints = {
            "assignment": (
                f"My accepted assignment: one row from event_app where "
                f"eventId = {event_id} AND senderId = {user_id} AND status = 'accepted'"
            ),
            "event": (
                f"Event details: one row from events where eventId = {event_id}"
            ),
            "host": (
                f"Current host profile: one row from users where userId = {user_id}"
            ),
            "venue": (
                f"Venue for this event: join venues v to events e on v.venueId = e.venueId "
                f"where e.eventId = {event_id} (return venue columns)"
            ),
            "clothing": (
                f"Event outfit and stock: join events e to clothing cl on e.clothesId = cl.clothesId, "
                f"join clothing_stock cs on cs.clothingId = cl.clothesId, "
                f"where e.eventId = {event_id}. Return one row per size with columns "
                f"clothesId, clothingLabel, picture, description, size, stockQty"
            ),
            "transport": (
                f"Transportation for event: rows from transportation where eventId = {event_id}"
            ),
            "team": (
                f"Event team: accepted hosts on event {event_id}. "
                f"SELECT ea.senderId AS host_id, ea.assignedRole AS assigned_role, "
                f"u.fName, u.lName, u.profilePic, u.description "
                f"FROM event_app ea JOIN users u ON u.userId = ea.senderId "
                f"WHERE ea.eventId = {event_id} AND ea.status = 'accepted'"
            ),
        }
        ordered = [lb for lb in label_list if lb in hints]

        parts = [f"{i + 1}. {lb} — {hints[lb]}" for i, lb in enumerate(ordered)]
        data_request = (
            f"Gatherly host briefing SQL pull.\n"
            f"event_id={event_id}, host user_id={user_id}.\n\n"
            f"Run ALL items below in ONE batched run_sql call, "
            f"semicolon-separated SELECTs, in this exact order:\n\n"
            + "\n\n".join(parts)
            + "\n\n"
            f"Rules:\n"
            f"- Exactly {len(ordered)} SELECT statements, same order as numbered list.\n"
            f"- Use SELECT * only when a fixed column list is not specified above.\n"
            f"- Add LIMIT 50 to each statement.\n"
            f"- Return query results only; no user-facing summary."
        )

        lookup = await gatherly_sql_lookup(
            data_request,
            role=role,
            user_id=user_id,
            progress_agent="fetch_briefing_sql",
        )

        executions = lookup.get("executions") or []
        sql_results: dict[str, list] = {}
        for i, lb in enumerate(ordered):
            sql_results[lb] = executions[i]["rows"] if i < len(executions) else []

        session["event_id"] = event_id
        session["sql_results"] = sql_results
        session["briefing_labels"] = ordered

        if lookup.get("status") != "success":
            await emit_progress(
                "sql_context",
                "failed",
                f"SQL fetch failed",
                "fetch_briefing_sql",
            )
            return _dumps({
                "status": "error",
                "event_id": event_id,
                "message": lookup.get("answer", "SQL fetch failed."),
            })

        await emit_progress(
            "sql_context",
            "running",
            "Preparing briefing context",
            "fetch_briefing_sql",
        )
        context = build_briefing_context_from_sql(
            event_id=event_id,
            user_id=user_id,
            role=role,
            sql_results=sql_results,
        )
        session["context"] = context

        if context.get("status") != "success":
            await emit_progress(
                "sql_context",
                "failed",
                context.get("message", "Briefing context failed"),
                "fetch_briefing_sql",
            )
            return _dumps(context)

        await emit_progress(
            "sql_context",
            "completed",
            f"Context ready ({context.get('source_count', 0)} sources)",
            "fetch_briefing_sql",
        )

        await emit_progress(
            "assignment",
            "running",
            "Checking assignment role, skills and responsibilities",
            "fetch_briefing_sql",
        )
        session["assignment"] = analyze_host_assignment(context)
        await emit_progress(
            "assignment",
            "completed",
            "Assignment requirements confirmed",
            "fetch_briefing_sql",
        )

        await emit_progress(
            "timeline",
            "running",
            "Building arrival timeline from event schedule",
            "fetch_briefing_sql",
        )
        session["timeline"] = build_host_timeline(context)
        await emit_progress(
            "timeline",
            "completed",
            f"Required arrival calculated: {session['timeline'].get('required_arrival')}",
            "fetch_briefing_sql",
        )

        await emit_progress(
            "clothing",
            "running",
            "Checking your requested outfit and size availability",
            "fetch_briefing_sql",
        )
        session["clothing"] = analyze_host_clothing(context)
        await emit_progress(
            "clothing",
            "completed",
            "Outfit check completed",
            "fetch_briefing_sql",
        )

        await emit_progress(
            "team",
            "running",
            "Building the privacy-safe event team",
            "fetch_briefing_sql",
        )
        session["team"] = build_safe_team_cards(context)
        await emit_progress(
            "team",
            "completed",
            f"Found {session['team'].get('team_size', 0)} authorized team members",
            "fetch_briefing_sql",
        )

        session["sql_fetch_done"] = True

        return _dumps({
            "status": "success",
            "event_id": event_id,
            "labels": ordered,
            "queries_run": len(executions),
            "source_count": context.get("source_count"),
            "assigned_role": session["assignment"].get("assigned_role"),
            "required_arrival": session["timeline"].get("required_arrival"),
            "team_size": session["team"].get("team_size"),
            "message": "SQL loaded; assignment, timeline, clothing, and team ready.",
        })


    async def check_event_weather(note: str = "") -> str:
        """Check event-day weather via MCP Open-Meteo for the venue."""
        _ = note
        await emit_progress(
            "weather",
            "running",
            "Calling Open-Meteo for event weather",
            "weather_agent",
        )
        result = await analyze_event_weather({
            "briefing_context": session.get("context") or {},
        })
        weather = result.get("weather_report", {})
        session["weather"] = weather
        await emit_progress(
            "weather",
            "completed",
            "Weather analysis completed",
            "weather_agent",
        )
        return _dumps(weather)

    async def calculate_live_route(note: str = "") -> str:
        """Calculate live driving route and suggested departure via MCP OSRM.

        Requires browser origin coordinates in session and a timeline.
        Call build_timeline before this when departure timing is needed.
        """
        _ = note
        if origin_latitude is None or origin_longitude is None:
            route = {
                "status": "location_required",
                "message": (
                    "Share your current location to calculate "
                    "a live route and departure time."
                ),
            }
            session["route"] = route
            await emit_progress(
                "route",
                "skipped",
                "Live route requires browser location",
                "route_agent",
            )
            return _dumps(route)

        timeline = session.get("timeline")
        if not timeline:
            timeline = build_host_timeline(session.get("context") or {})
            session["timeline"] = timeline

        await emit_progress(
            "route",
            "running",
            "Calling OSRM for your live route and departure time",
            "route_agent",
        )
        route = await analyze_host_route(
            context=session.get("context") or {},
            timeline=timeline,
            origin_latitude=origin_latitude,
            origin_longitude=origin_longitude,
        )
        session["route"] = route
        await emit_progress(
            "route",
            "completed" if route.get("status") == "success" else "skipped",
            (
                "Live route completed"
                if route.get("status") == "success"
                else "Live route requires browser location"
            ),
             "route_agent",
        )
        return _dumps(route)

    async def assemble_host_briefing(note: str = "") -> str:
        """Assemble the structured briefing artifact from tools already run.

        Call after the relevant briefing tools. For a complete briefing,
        typically run assignment, timeline, clothing, team, weather, and
        route (when location is available).
        """
        _ = note
        briefing = _build_briefing_artifact(session)
        if briefing is None:
            return _dumps({
                "status": "error",
                "message": "Load briefing context before assembling.",
            })
        session["briefing"] = briefing
        await emit_progress(
            "briefing",
            "completed",
            "Combined timeline, weather, route, outfit and team briefing",
            "assemble_host_briefing",
        )
        return _dumps(briefing)

    async def render_briefing_visualization(
        markdown: str,
        chart_json: str = "",
        mermaid: str = "",
    ) -> str:
        """Render agent-designed markdown + optional chart/Mermaid via MCP.

        Call AFTER assemble_host_briefing. You invent the layout; do not invent facts.
        """
        briefing = session.get("briefing")
        if not briefing or briefing.get("status") != "success":
            return _dumps({
                "status": "error",
                "message": "Assemble the briefing before rendering a visualization.",
            })

        text = (markdown or "").strip()
        if not text:
            return _dumps({
                "status": "error",
                "message": "markdown is required.",
            })

        # Soft safety: keep weather + host photos visible even if the LLM omits them.
        weather_wrap = briefing.get("weather") or {}
        weather = weather_wrap.get("weather") or {}
        if (
            weather.get("status") == "success"
            and "weather" not in text.lower()
        ):
            text = (
                f"**Weather:** {weather.get('temperature_min_c')}–"
                f"{weather.get('temperature_max_c')}°C, "
                f"rain {weather.get('precipitation_mm')} mm\n\n"
                + text
            )

        
        # Route: label OSRM vs Google Maps; repair fake placeholders; bare map URL.
        route = briefing.get("route") or {}
        real_map_url = (
            route.get("map_url") if route.get("status") == "success" else None
        )
        already_has_osrm = (
            "OSRM estimate" in text
            or "Leave by (OSRM" in text
            or "Live Route (OSRM)" in text
        )
        already_has_map = bool(real_map_url and real_map_url in text)
        if route.get("status") == "success" and not already_has_osrm:
            block = ["", "## Route"]
            if route.get("travel_minutes") is not None:
                dist = route.get("distance_km")
                dist_bit = f", {dist} km" if dist is not None else ""
                block.append(
                    f"- **OSRM estimate:** {route['travel_minutes']} min"
                    f"{dist_bit}"
                )
            if route.get("suggested_departure"):
                block.append(
                    f"- **Leave by (OSRM only, no traffic buffer):** "
                    f"{route['suggested_departure']}"
                )
            if route.get("required_arrival"):
                block.append(
                    f"- **Required arrival:** {route['required_arrival']}"
                )
            if real_map_url and not already_has_map:
                block.append(
                    "- **Google Maps:** live directions "
                    "(ETA may differ from OSRM)."
                )
                block.append(real_map_url)
            block.append(
                "_Leave-by uses OSRM drive time only and does not include "
                "live traffic. Check Google Maps before you go and leave "
                "earlier if needed._"
            )
            text = text.rstrip() + "\n" + "\n".join(block)

        if real_map_url:
            text = (
                text.replace("{{route.map_url}}", real_map_url)
                .replace("{{{route.map_url}}}", real_map_url)
                .replace("{{ map_url }}", real_map_url)
                .replace("{{map_url}}", real_map_url)
            )
            text = re.sub(
                r"\[([^\]]*)\]\(\{\{[^)]*\}\}\)",
                rf"[\1]({real_map_url})",
                text,
            )
            if real_map_url not in text:
                text = text.rstrip() + f"\n\n{real_map_url}"

        team = briefing.get("team") or {}
        members = team.get("members") or []
        hosts_have_photos = any(
            (member.get("image_url") or "") in text
            for member in members
            if member.get("image_url")
        )
        if members and not hosts_have_photos:
            host_lines = ["", "## Hosts"]
            for member in members:
                name = member.get("name") or "Host"
                role = str(
                    member.get("assigned_role") or "host"
                ).replace("_", " ")
                you = " (you)" if member.get("is_current_host") else ""
                image_url = member.get("image_url")
                if image_url:
                    host_lines.append(
                        f"- ![{name}]({image_url}) **{name}**{you} — {role}"
                    )
                else:
                    host_lines.append(f"- **{name}**{you} — {role}")
            text = text.rstrip() + "\n" + "\n".join(host_lines)

        date_prefix = _briefing_date_prefix(briefing)
        if date_prefix:
            text = _expand_clock_times_with_date(text, date_prefix)

        chart = None
        raw_chart = (chart_json or "").strip()
        if raw_chart:
            try:
                parsed = json.loads(raw_chart)
                if isinstance(parsed, dict):
                    chart = parsed
            except json.JSONDecodeError:
                chart = None

        mermaid_text = (mermaid or "").strip() or None
        # Prefer one visual to avoid clutter
        if chart and mermaid_text:
            mermaid_text = None

        mcp = GatherlyMCPClient()
        viz = await mcp.render_visualization(
            markdown=text,
            chart=chart,
            mermaid=mermaid_text,
        )
        session["visualization"] = viz
        await emit_progress(
            "visualization",
            "completed",
            "Rendered briefing visualization via MCP",
            "render_briefing_visualization",
        )
        return _dumps(viz)


    return [
        StructuredTool.from_function(
            coroutine=fetch_briefing_sql,
            name="fetch_briefing_sql",
            description=(
                "Load SQL, build context, run assignment/timeline/clothing/team. "
                "Call once first."
            ),
            args_schema=FetchBriefingArgs,
        ),
        
        StructuredTool.from_function(
            coroutine=check_event_weather,
            name="check_event_weather",
            description="Check venue weather via MCP. Use alone for weather-only asks.",
            args_schema=EmptyArgs,
        ),
        StructuredTool.from_function(
            coroutine=calculate_live_route,
            name="calculate_live_route",
            description=(
                "Calculate live route/departure via MCP when origin "
                "coordinates are available."
            ),
            args_schema=EmptyArgs,
        ),
        StructuredTool.from_function(
            coroutine=assemble_host_briefing,
            name="assemble_host_briefing",
            description=(
                "Assemble the structured briefing from tools already run. "
                "Then call render_briefing_visualization for the user answer."
            ),
            args_schema=EmptyArgs,
        ),
        StructuredTool.from_function(
            coroutine=render_briefing_visualization,
            name="render_briefing_visualization",
            description=(
                "After assemble_host_briefing, design the user-facing answer: "
                "markdown required; optional chart_json and/or mermaid. "
                "Choose creatively from retrieved facts (weather, route times, "
                "team photos, risks). Do not invent data."
            ),
            args_schema=VisualizationArgs,
        ),
    ]
