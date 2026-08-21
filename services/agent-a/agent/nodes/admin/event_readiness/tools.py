"""LangChain tools for the Event Readiness specialist.

Staffing and logistics run inside load_readiness_context after SQL (like host
fetch_briefing_sql). Weather stays a separate MCP tool. Score runs inside
render_readiness_visualization.
"""

from __future__ import annotations

import json
from typing import Any

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from agent.nodes.admin.event_readiness.logistics import (analyze_logistics)
from agent.nodes.admin.event_readiness.staffing import (analyze_staffing)
from agent.nodes.shared.weather import analyze_event_weather
from agent.services.mcp_tools import GatherlyMCPClient
from agent.utils.progress import emit_progress
from tools.admin.event_readiness.readiness_tool import (calculate_readiness_score)
from agent.nodes.shared.sql_agent import gatherly_sql_lookup
from agent.services.readiness_sql_adapter import (
    build_readiness_context_from_sql,
    labels_for_scope,
)


class LoadReadinessContextArgs(BaseModel):
    event_id: int = Field(..., description="Gatherly event ID to assess.")
    scope: str = Field(
        default="full",
        description=(
            "Minimal SQL scope: full / weather / staffing / logistics. "
        ),
    )


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
            "Admin-facing readiness markdown using ONLY facts from "
            "the readiness session. Include Overview, Weather (temps + "
            "venue_setting and how that changed risk), Staffing (required vs "
            "assigned, leader, skills/languages), Logistics (capacity, "
            "accessibility, transport, clothing), Deductions, Risks, "
            "Recommendations. No invented numbers. No chart."
        ),
    )
    mermaid: str = Field(
        ...,
        description=(
            "Required for complete readiness: small Mermaid flowchart of "
            "score → weather/staffing/logistics using real values. "
            "Empty string only for partial weather/staffing/logistics-only answers."
        ),
    )


def _dumps(payload: Any) -> str:
    return json.dumps(payload, default=str)


def _scope_runs_staffing(scope: str) -> bool:
    return scope in {"staffing", "full"}


def _scope_runs_logistics(scope: str) -> bool:
    return scope in {"logistics", "full"}


def build_readiness_tools(session: dict, role: str, user_id: int) -> list:
    """Build tools closed over a mutable session for one specialist run."""

    async def load_readiness_context(
        event_id: int,
        scope: str = "full",
    ) -> str:
        """Load readiness evidence via shared SQL service. Call first."""

        scope = (scope or "full").strip().lower()
        cache_scope = session.get("readiness_scope")
        if (
            session.get("readiness_sql_done")
            and session.get("event_id") == event_id
            and (cache_scope == scope or cache_scope == "full")
        ):
            cached = {
                "status": "success",
                "event_id": event_id,
                "scope": scope,
                "cached": True,
                "message": "Readiness context already loaded.",
            }
            if session.get("staffing_report"):
                cached["staffing_shortage"] = session["staffing_report"].get(
                    "shortage", 0
                )
            if session.get("logistics_report"):
                cached["logistics_risks"] = len(
                    session["logistics_report"].get("risks", [])
                )
            return _dumps(cached)

        scope_messages = {
            "weather": "Fetching event and venue from SQL",
            "staffing": "Fetching event and staffing from SQL",
            "logistics": "Fetching event, venue, staffing and logistics from SQL",
            "full": "Fetching full readiness evidence from SQL",
        }
        await emit_progress(
            "sql_context",
            "running",
            scope_messages.get(scope, scope_messages["full"]),
            "load_readiness_context",
        )

        hints = {
            "event": (
                f"Event details: one row from events where eventId = {event_id}"
            ),
            "venue": (
                f"Venue for this event: join venues v to events e "
                f"on v.venueId = e.venueId where e.eventId = {event_id} "
                f"(return venue columns)"
            ),
            "applications": (
                f"Accepted applications on event {event_id}: "
                f"SELECT ea.eventAppId, ea.senderId, ea.status, "
                f"ea.requestedRole, ea.assignedRole, ea.needsRide, "
                f"ea.requestDress, ea.requestTransportation, "
                f"u.fName, u.lName "
                f"FROM event_app ea JOIN users u ON u.userId = ea.senderId "
                f"WHERE ea.eventId = {event_id} AND ea.status = 'accepted'"
            ),
            "hosts": (
                f"Host profiles for accepted apps on event {event_id}: "
                f"SELECT u.userId, u.fName, u.lName, u.email, u.clothingSize, "
                f"u.description, u.eligibility, u.isActive "
                f"FROM users u JOIN event_app ea ON ea.senderId = u.userId "
                f"WHERE ea.eventId = {event_id} AND ea.status = 'accepted'"
            ),
            "transport": (
                f"Transportation for event: rows from transportation "
                f"where eventId = {event_id}"
            ),
            "clothing": (
                f"Event clothing and stock: join events e to clothing cl "
                f"on e.clothesId = cl.clothesId, join clothing_stock cs "
                f"on cs.clothingId = cl.clothesId, where e.eventId = {event_id}. "
                f"Return one row per size with columns clothesId, clothingLabel, "
                f"picture, description, size, stockQty"
            ),
        }

        label_list = labels_for_scope(scope)
        ordered = [lb for lb in label_list if lb in hints]

        parts = [f"{i + 1}. {lb} — {hints[lb]}" for i, lb in enumerate(ordered)]
        data_request = (
            f"Gatherly event readiness SQL pull.\n"
            f"event_id={event_id}, admin user_id={user_id}.\n\n"
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
            progress_agent="load_readiness_context",
        )

        executions = lookup.get("executions") or []
        sql_results: dict[str, list] = {}
        for i, lb in enumerate(ordered):
            sql_results[lb] = (
                executions[i]["rows"] if i < len(executions) else []
            )

        if lookup.get("status") != "success":
            await emit_progress(
                "sql_context",
                "failed",
                "SQL fetch failed",
                "load_readiness_context",
            )
            return _dumps({
                "status": "error",
                "event_id": event_id,
                "scope": scope,
                "message": lookup.get("answer", "SQL fetch failed."),
            })

        context = build_readiness_context_from_sql(
            event_id=event_id,
            role=role,
            sql_results=sql_results,
            scope=scope,
        )

        session["event_id"] = event_id
        session["readiness_scope"] = scope
        session["sql_results"] = sql_results
        session["context"] = context

        if context.get("status") != "success":
            await emit_progress(
                "sql_context",
                "failed",
                context.get("message", "Readiness context failed"),
                "load_readiness_context",
            )
            return _dumps(context)

        await emit_progress(
            "sql_context",
            "completed",
            f"Context ready ({context.get('source_count', 0)} sources, scope={scope})",
            "load_readiness_context",
        )

        run_staffing = _scope_runs_staffing(scope)
        run_logistics = _scope_runs_logistics(scope)

        if run_staffing:
            await emit_progress(
                "staffing",
                "running",
                "Checking host count, skills, languages and team leader",
                "load_readiness_context",
            )
            staffing_result = await analyze_staffing({
                "readiness_context": context,
            })
            session["staffing_report"] = staffing_result.get(
                "staffing_report", {}
            )
            await emit_progress(
                "staffing",
                "completed",
                "Staffing readiness completed",
                "load_readiness_context",
            )

        if run_logistics:
            await emit_progress(
                "logistics",
                "running",
                "Checking capacity, accessibility, transport and clothing",
                "load_readiness_context",
            )
            logistics_result = await analyze_logistics({
                "readiness_context": context,
            })
            session["logistics_report"] = logistics_result.get(
                "logistics_report", {}
            )
            await emit_progress(
                "logistics",
                "completed",
                "Logistics readiness completed",
                "load_readiness_context",
            )

        session["readiness_sql_done"] = True

        payload = {
            "status": "success",
            "event_id": event_id,
            "scope": scope,
            "labels": ordered,
            "queries_run": len(executions),
            "source_count": context.get("source_count"),
            "message": "Readiness context loaded.",
        }
        if run_staffing:
            payload["staffing_shortage"] = session["staffing_report"].get(
                "shortage", 0
            )
        if run_logistics:
            payload["logistics_risks"] = len(
                session["logistics_report"].get("risks", [])
            )
        if scope == "weather":
            payload["message"] += " Run check_weather_readiness next."
        elif scope in {"staffing", "logistics"}:
            payload["message"] += " Analysis complete for this scope."
        else:
            payload["message"] += (
                " Staffing and logistics ready."
                " Run check_weather_readiness then render_readiness_visualization."
            )
        return _dumps(payload)

    async def check_weather_readiness(note: str = "") -> str:
        """Assess weather risk for the loaded event via MCP Open-Meteo.

        Requires load_readiness_context first. Use alone for weather-only asks.
        """
        _ = note
        context = session.get("context") or {}
        await emit_progress(
            "weather",
            "running",
            "Calling Open-Meteo and checking weather risks",
            "weather",
        )
        result = await analyze_event_weather({
            "readiness_context": context,
        })
        report = result.get("weather_report", {})
        session["weather_report"] = report
        await emit_progress(
            "weather",
            "completed",
            "Weather readiness completed",
            "weather",
        )
        return _dumps(report)

    async def _ensure_readiness_score() -> dict | None:
        weather_report = session.get("weather_report") or {
            "risks": [],
            "recommendations": [],
        }
        staffing_report = session.get("staffing_report") or {
            "risks": [],
            "recommendations": [],
            "shortage": 0,
            "missing_languages": [],
            "missing_skills": [],
            "has_team_leader": True,
        }
        logistics_report = session.get("logistics_report") or {
            "risks": [],
            "recommendations": [],
        }

        await emit_progress(
            "scoring",
            "running",
            "Calculating readiness score and explainable deductions",
            "render_readiness_visualization",
        )
        scoring = calculate_readiness_score(
            weather_report=weather_report,
            staffing_report=staffing_report,
            logistics_report=logistics_report,
        )

        risks = list(dict.fromkeys(
            weather_report.get("risks", [])
            + staffing_report.get("risks", [])
            + logistics_report.get("risks", [])
        ))
        recommendations = list(dict.fromkeys(
            weather_report.get("recommendations", [])
            + staffing_report.get("recommendations", [])
            + logistics_report.get("recommendations", [])
        ))

        readiness = {
            "status": "success",
            "event_id": session.get("event_id"),
            "score": scoring["score"],
            "level": scoring["level"],
            "deductions": scoring["deductions"],
            "risks": risks,
            "recommendations": recommendations,
            "reports": {
                "weather": weather_report,
                "staffing": staffing_report,
                "logistics": logistics_report,
            },
            "source_count": (session.get("context") or {}).get(
                "source_count",
                0,
            ),
        }
        session["readiness_result"] = readiness
        await emit_progress(
            "scoring",
            "completed",
            f"Readiness score calculated: {scoring['score']}/100",
            "render_readiness_visualization",
        )
        return readiness


    async def render_readiness_visualization(
        markdown: str,
        mermaid: str = "",
    ) -> str:
        """Render admin readiness markdown via MCP. Scores automatically."""

        readiness = session.get("readiness_result")
        if not readiness or readiness.get("status") != "success":
            readiness = await _ensure_readiness_score()
        if not readiness or readiness.get("status") != "success":
            return _dumps({
                "status": "error",
                "message": "Could not calculate readiness score.",
            })

        text = (markdown or "").strip()
        if not text:
            return _dumps({
                "status": "error",
                "message": "markdown is required.",
            })

        await emit_progress(
            "visualization",
            "running",
            "Rendering readiness visualization via MCP",
            "render_readiness_visualization",
        )

        # Soft safety only — agent still owns the narrative.
        if "score" not in text.lower():
            text = (
                f"**Score:** {readiness.get('score')}/100 "
                f"({str(readiness.get('level') or '').replace('_', ' ')})\n\n"
                + text
            )

        reports = readiness.get("reports") or {}
        weather = reports.get("weather") or {}
        staffing = reports.get("staffing") or {}
        logistics = reports.get("logistics") or {}
        weather_data = weather.get("weather") or {}

        if "weather" not in text.lower() and weather:
            bits = ["", "## Weather (evidence)"]
            if weather.get("venue_setting"):
                bits.append(
                    f"- **Venue setting:** {weather.get('venue_setting')}"
                )
            if weather_data.get("status") == "success":
                bits.append(
                    f"- **Forecast:** "
                    f"{weather_data.get('temperature_min_c')}–"
                    f"{weather_data.get('temperature_max_c')}°C, "
                    f"rain {weather_data.get('precipitation_mm')} mm, "
                    f"wind {weather_data.get('maximum_wind_kmh')} km/h"
                )
            if weather.get("weather_score") is not None:
                bits.append(
                    f"- **Weather score:** {weather.get('weather_score')}"
                )
            for risk in (weather.get("risks") or [])[:8]:
                bits.append(f"- Risk: {risk}")
            for tip in (weather.get("recommendations") or [])[:5]:
                bits.append(f"- Recommendation: {tip}")
            text = text.rstrip() + "\n" + "\n".join(bits)

        if "staffing" not in text.lower() and staffing:
            bits = ["", "## Staffing (evidence)"]
            if staffing.get("required_hosts") is not None:
                bits.append(
                    f"- **Hosts:** {staffing.get('assigned_hosts', 0)}/"
                    f"{staffing.get('required_hosts')} "
                    f"(shortage {staffing.get('shortage', 0)})"
                )
            if "has_team_leader" in staffing:
                bits.append(
                    f"- **Team leader:** "
                    f"{'yes' if staffing.get('has_team_leader') else 'no'}"
                )
            missing_skills = staffing.get("missing_skills") or []
            missing_languages = staffing.get("missing_languages") or []
            if missing_skills:
                bits.append(
                    f"- **Missing skills:** {', '.join(missing_skills)}"
                )
            if missing_languages:
                bits.append(
                    f"- **Missing languages:** "
                    f"{', '.join(missing_languages)}"
                )
            for risk in (staffing.get("risks") or [])[:8]:
                bits.append(f"- Risk: {risk}")
            text = text.rstrip() + "\n" + "\n".join(bits)

        if "logistics" not in text.lower() and logistics:
            bits = ["", "## Logistics (evidence)"]
            for risk in (logistics.get("risks") or [])[:8]:
                bits.append(f"- Risk: {risk}")
            for tip in (logistics.get("recommendations") or [])[:5]:
                bits.append(f"- Recommendation: {tip}")
            if len(bits) > 2:
                text = text.rstrip() + "\n" + "\n".join(bits)

        mermaid_text = (mermaid or "").strip() or None

        mcp = GatherlyMCPClient()
        viz = await mcp.render_visualization(
            markdown=text,
            chart=None,
            mermaid=mermaid_text,
        )
        session["visualization"] = viz
        await emit_progress(
            "visualization",
            "completed",
            "Rendered readiness visualization via MCP",
            "render_readiness_visualization",
        )
        return _dumps(viz)

    return [
        StructuredTool.from_function(
            coroutine=load_readiness_context,
            name="load_readiness_context",
            description=(
                "Load readiness SQL and run staffing/logistics analysis for "
                "the scope. scope: weather / staffing / logistics / full. "
                "Call first."
            ),
            args_schema=LoadReadinessContextArgs,
        ),
        StructuredTool.from_function(
            coroutine=check_weather_readiness,
            name="check_weather_readiness",
            description=(
                "Check weather risk via MCP Open-Meteo. Requires "
                "load_readiness_context(scope='weather' or 'full') first."
            ),
            args_schema=EmptyArgs,
        ),
        StructuredTool.from_function(
            coroutine=render_readiness_visualization,
            name="render_readiness_visualization",
            description=(
                "Score and render the admin-facing readiness answer. "
                "markdown required; mermaid required for full assessments."
            ),
            args_schema=VisualizationArgs,
        ),
    ]
