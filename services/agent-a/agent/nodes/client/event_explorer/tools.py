"""LangChain tools for the Client Event Explorer specialist.

Venue matching runs inside load_client_event_context after SQL (like host
fetch_briefing_sql). Weather and routes stay separate MCP tools. Final score
merge runs inside render_explorer_visualization.
"""

from __future__ import annotations

import json
from typing import Any

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from agent.nodes.client.event_explorer.route_comparison import (
    compare_venue_routes,
)
from agent.nodes.client.event_explorer.venue_match import (
    score_candidate_venues,
)
from agent.nodes.client.event_explorer.weather_comparison import (
    compare_venue_weather,
)
from agent.nodes.shared.sql_agent import gatherly_sql_lookup
from agent.services.explorer_sql_adapter import (
    build_explorer_context_from_sql,
    labels_for_scope,
)
from agent.services.mcp_tools import GatherlyMCPClient
from agent.utils.progress import emit_progress


class LoadExplorerContextArgs(BaseModel):
    event_id: int = Field(..., description="Client-owned Gatherly event ID.")
    scope: str = Field(
        default="full",
        description=(
            "Explorer scope: full / suitability / weather / routes. "
            "SQL is the same; scope hints which follow-up tools to use."
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
            "Client-facing venue comparison markdown using ONLY facts from "
            "the explorer session. Prefer short TABLES for Best match, "
            "Ranked venues, Weather, and Route. Short bullets for risks. "
            "No invented numbers."
        ),
    )
    chart: dict | None = Field(
        default=None,
        description=(
            "Optional chart YOU build from explorer final_score values only. "
            "MCP shape (top-level keys, NOT nested under data): "
            '{"type":"bar","title":"Venue scores",'
            '"labels":["Venue A","Venue B"],'
            '"datasets":[{"label":"Final score","values":[80,65]}]}. '
            "Use real venue names and final_score values. "
            "Omit or null if the user does not need a chart. "
            "Do not invent scores. No Mermaid."
        ),
    )


def _dumps(payload: Any) -> str:
    return json.dumps(payload, default=str)


def _selected_venues(matching: dict) -> list:
    selected = list(matching.get("ranked_venues", [])[:5])
    current = matching.get("current_venue")
    if current and not any(
        venue["record_id"] == current["record_id"]
        for venue in selected
    ):
        selected.append(current)
    return selected


def _assemble_explorer_result(session: dict) -> dict:
    context = session["context"]
    matching = session["matching"]
    selected_venues = session.get("selected_venues") or _selected_venues(
        matching
    )
    weather_result = session.get("weather_result") or {
        "venue_weather": [],
    }
    route_result = session.get("route_result") or {
        "status": "skipped",
        "venue_routes": [],
    }

    weather_by_id = {
        item["record_id"]: item
        for item in weather_result.get("venue_weather", [])
    }
    route_by_id = {
        item["record_id"]: item
        for item in route_result.get("venue_routes", [])
    }

    final_venues = []
    for venue in selected_venues:
        record_id = venue["record_id"]
        weather = weather_by_id.get(record_id, {})
        route = route_by_id.get(record_id, {})
        suitability_score = venue["score"]
        weather_score = weather.get("weather_score")
        route_score = route.get("route_score")

        weighted_total = suitability_score * 0.70
        applied_weight = 0.70
        if weather_score is not None:
            weighted_total += weather_score * 0.15
            applied_weight += 0.15
        if route_score is not None:
            weighted_total += route_score * 0.15
            applied_weight += 0.15

        final_score = round(weighted_total / applied_weight)
        final_venues.append({
            **venue,
            "weather_report": weather,
            "route_report": route,
            "final_score": final_score,
            "final_score_breakdown": {
                "venue_suitability": {
                    "score": suitability_score,
                    "weight": 70,
                },
                "weather": {
                    "score": weather_score,
                    "weight": 15,
                    "applied": weather_score is not None,
                },
                "route": {
                    "score": route_score,
                    "weight": 15,
                    "applied": route_score is not None,
                },
            },
            "external_links": {
                "google_maps": route.get("google_maps_directions_url"),
            },
        })

    final_venues.sort(
        key=lambda item: (item["eligible"], item["final_score"]),
        reverse=True,
    )
    best_match = final_venues[0] if final_venues else None

    used = ["sql_context", "venue_matching"]
    if session.get("weather_result"):
        used.append("shared_weather")
    if session.get("route_result"):
        used.append("route_comparison")
    used.append("visualization_composer")

    return {
        "status": "success",
        "feature": "client_event_explorer",
        "event_id": session.get("event_id"),
        "user_id": session.get("user_id"),
        "location_notice": (
            "Venue destinations use database coordinates. "
            "The client's origin is temporary and is not saved."
        ),
        "best_match": best_match,
        "current_venue": next(
            (
                venue
                for venue in final_venues
                if venue.get("is_current_venue")
            ),
            None,
        ),
        "ranked_venues": final_venues,
        "visualizations": {
            "score_bar_chart": {
                "labels": [venue["name"] for venue in final_venues],
                "values": [
                    venue["final_score"] for venue in final_venues
                ],
            },
            "radar_chart": {
                "axes": [
                    "Capacity",
                    "Accessibility",
                    "Parking",
                    "Event type fit",
                    "Setting resilience",
                    "Weather",
                    "Route convenience",
                ],
                "datasets": [
                    {
                        "record_id": venue["record_id"],
                        "label": venue["name"],
                        "values": [
                            venue["chart_values"]["capacity"],
                            venue["chart_values"]["accessibility"],
                            venue["chart_values"]["parking"],
                            venue["chart_values"]["event_type_fit"],
                            venue["chart_values"]["setting_resilience"],
                            venue["weather_report"].get("weather_score"),
                            venue["route_report"].get("route_score"),
                        ],
                    }
                    for venue in final_venues[:3]
                ],
            },
        },
        "source_count": context["source_count"],
        "subagents": used,
    }


def build_client_explorer_tools(
    session: dict,
    *,
    user_id: int,
    origin_latitude: float | None,
    origin_longitude: float | None,
) -> list:
    session["user_id"] = user_id

    async def load_client_event_context(
        event_id: int,
        scope: str = "full",
    ) -> str:
        """Load client event + candidates via shared SQL; run venue matching."""

        scope = (scope or "full").strip().lower()
        cache_scope = session.get("explorer_scope")
        if (
            session.get("explorer_sql_done")
            and session.get("event_id") == event_id
            and (cache_scope == scope or cache_scope == "full")
        ):
            cached = {
                "status": "success",
                "event_id": event_id,
                "scope": scope,
                "cached": True,
                "message": "Client event context already loaded.",
            }
            matching = session.get("matching") or {}
            if matching.get("ranked_venues"):
                cached["ranked_count"] = len(matching["ranked_venues"])
                cached["top_venue"] = (
                    (matching["ranked_venues"][0] or {}).get("name")
                )
            return _dumps(cached)

        await emit_progress(
            "sql_context",
            "running",
            "Verifying ownership and loading venue candidates from SQL",
            "load_client_event_context",
        )

        hints = {
            "event": (
                f"Client-owned event: SELECT eventId, title, type, description, "
                f"location, startsAt, endsAt, nbOfGuests, nbOfHosts, status, "
                f"venueId, clientId, locationLat, locationLng FROM events "
                f"WHERE eventId = {event_id} AND clientId = {user_id} LIMIT 1"
            ),
            "current_venue": (
                f"Current booked venue for event {event_id}: "
                f"SELECT v.* FROM events e JOIN venues v ON v.venueId = e.venueId "
                f"WHERE e.eventId = {event_id} AND e.clientId = {user_id} LIMIT 1"
            ),
            "candidates": (
                f"Candidate venues with enough capacity: "
                f"SELECT * FROM venues WHERE capacity >= "
                f"(SELECT nbOfGuests FROM events WHERE eventId = {event_id} "
                f"AND clientId = {user_id} LIMIT 1) "
                f"ORDER BY capacity ASC LIMIT 8"
            ),
            "venue_extras": (
                f"Extra large venues to fill candidate list: "
                f"SELECT * FROM venues ORDER BY capacity DESC LIMIT 8"
            ),
        }

        label_list = labels_for_scope(scope)
        ordered = [lb for lb in label_list if lb in hints]

        parts = [f"{i + 1}. {lb} — {hints[lb]}" for i, lb in enumerate(ordered)]
        data_request = (
            f"Gatherly client event explorer SQL pull.\n"
            f"event_id={event_id}, client user_id={user_id}.\n\n"
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
            role="client",
            user_id=user_id,
            progress_agent="load_client_event_context",
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
                "load_client_event_context",
            )
            return _dumps({
                "status": "error",
                "event_id": event_id,
                "scope": scope,
                "message": lookup.get("answer", "SQL fetch failed."),
            })

        context = build_explorer_context_from_sql(
            event_id=event_id,
            user_id=user_id,
            role="client",
            sql_results=sql_results,
            scope=scope,
        )

        session["event_id"] = event_id
        session["explorer_scope"] = scope
        session["sql_results"] = sql_results
        session["context"] = context

        if context.get("status") != "success":
            await emit_progress(
                "sql_context",
                "failed",
                context.get("message", "Explorer context failed"),
                "load_client_event_context",
            )
            return _dumps(context)

        await emit_progress(
            "sql_context",
            "completed",
            f"Loaded {context.get('source_count', 0)} SQL sources",
            "load_client_event_context",
        )

        await emit_progress(
            "venue_matching",
            "running",
            "Comparing venue capacity, accessibility, parking and event fit",
            "load_client_event_context",
        )
        matching = score_candidate_venues(
            event=context["event"],
            venues=context["candidate_venues"],
        )
        session["matching"] = matching
        session["selected_venues"] = _selected_venues(matching)
        await emit_progress(
            "venue_matching",
            "completed",
            "Venue suitability scoring completed",
            "load_client_event_context",
        )

        session["explorer_sql_done"] = True

        payload = {
            "status": "success",
            "event_id": event_id,
            "scope": scope,
            "labels": ordered,
            "queries_run": len(executions),
            "candidate_count": len(context.get("candidate_venues", [])),
            "ranked_count": len(matching.get("ranked_venues", [])),
            "top_venues": [
                {
                    "name": venue.get("name"),
                    "score": venue.get("score"),
                    "eligible": venue.get("eligible"),
                }
                for venue in session["selected_venues"][:5]
            ],
            "message": "Event loaded and venues scored.",
        }
        if scope in {"full", "weather"}:
            payload["message"] += " Run compare_weather when needed."
        if scope in {"full", "routes"}:
            payload["message"] += (
                " Run compare_routes when location is available."
            )
        if scope == "full":
            payload["message"] += " Then render_explorer_visualization."
        elif scope == "suitability":
            payload["message"] += " Suitability ready; render optional."
        return _dumps(payload)

    async def compare_weather(note: str = "") -> str:
        """Compare weather for top ranked venues via MCP Open-Meteo."""
        _ = note
        context = session.get("context") or {}
        selected = session.get("selected_venues")
        if not selected:
            return _dumps({
                "status": "error",
                "message": "Load client event context first.",
            })

        await emit_progress(
            "weather",
            "running",
            "Calling Open-Meteo for candidate weather conditions",
            "compare_weather",
        )
        weather_result = await compare_venue_weather(
            event=context["event"],
            ranked_venues=selected,
            limit=len(selected),
        )
        session["weather_result"] = weather_result
        await emit_progress(
            "weather",
            "completed",
            "Weather comparison completed",
            "compare_weather",
        )
        return _dumps(weather_result)

    async def compare_routes(note: str = "") -> str:
        """Compare driving routes to top venues via MCP OSRM.

        Requires browser origin coordinates. Skip when location is missing.
        """
        _ = note
        selected = session.get("selected_venues")
        if not selected:
            return _dumps({
                "status": "error",
                "message": "Load client event context first.",
            })

        if origin_latitude is None or origin_longitude is None:
            route_result = {
                "status": "location_required",
                "venue_routes": [
                    {
                        "record_id": venue["record_id"],
                        "name": venue["name"],
                        "status": "location_required",
                        "route_score": None,
                        "message": (
                            "Share a temporary location for live "
                            "route comparison."
                        ),
                    }
                    for venue in selected
                ],
            }
            session["route_result"] = route_result
            await emit_progress(
                "route",
                "skipped",
                "Live route comparison requires browser location",
                "compare_routes",
            )
            return _dumps(route_result)

        await emit_progress(
            "route",
            "running",
            "Calling OSRM for distance and travel-time comparisons",
            "compare_routes",
        )
        route_result = await compare_venue_routes(
            selected,
            origin_latitude=origin_latitude,
            origin_longitude=origin_longitude,
            limit=len(selected),
        )
        session["route_result"] = route_result
        await emit_progress(
            "route",
            "completed",
            "Route comparison completed",
            "compare_routes",
        )
        return _dumps(route_result)

    async def _ensure_explorer_assembled() -> dict | None:
        explorer = session.get("explorer")
        if explorer and explorer.get("status") == "success":
            return explorer
        if "matching" not in session or "context" not in session:
            return None

        await emit_progress(
            "scoring",
            "running",
            "Combining suitability, weather and route scores",
            "render_explorer_visualization",
        )
        result = _assemble_explorer_result(session)
        session["explorer"] = result
        await emit_progress(
            "scoring",
            "completed",
            "Ranked venue comparison assembled",
            "render_explorer_visualization",
        )
        return result

    async def render_explorer_visualization(
        markdown: str,
        chart: dict | None = None,
    ) -> str:
        """Render client markdown via MCP. Assembles scores automatically."""

        explorer = session.get("explorer")
        if not explorer or explorer.get("status") != "success":
            explorer = await _ensure_explorer_assembled()
        if not explorer or explorer.get("status") != "success":
            return _dumps({
                "status": "error",
                "message": "Could not assemble venue comparison.",
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
            "Rendering venue comparison via MCP",
            "render_explorer_visualization",
        )

        best = explorer.get("best_match") or {}
        current = explorer.get("current_venue") or {}
        ranked = explorer.get("ranked_venues") or []
        lower = text.lower()

        if "best" not in lower and best.get("name"):
            bits = [
                "",
                "## Best match (evidence)",
                f"- **Venue:** {best.get('name')}",
                f"- **Score:** {best.get('final_score')}/100",
                f"- **Capacity:** {best.get('capacity')}",
                (
                    "- **Accessible:** "
                    f"{'Yes' if best.get('wheelchair_accessible') else 'No'}"
                ),
                (
                    "- **Parking:** "
                    f"{'Yes' if best.get('parking_available') else 'No'}"
                ),
            ]
            text = text.rstrip() + "\n" + "\n".join(bits)

        if "rank" not in lower and ranked:
            bits = ["", "## Ranked venues (evidence)"]
            for venue in ranked[:5]:
                bits.append(
                    f"- **{venue.get('name')}** — "
                    f"{venue.get('final_score')}/100"
                )
            text = text.rstrip() + "\n" + "\n".join(bits)

        weather = (best.get("weather_report") or {}).get("weather") or {}
        if (
            "weather" not in lower
            and weather.get("status") == "success"
        ):
            bits = [
                "",
                "## Weather (evidence)",
                (
                    f"- **Forecast:** "
                    f"{weather.get('temperature_min_c')}–"
                    f"{weather.get('temperature_max_c')}°C, "
                    f"rain {weather.get('precipitation_mm')} mm"
                ),
            ]
            text = text.rstrip() + "\n" + "\n".join(bits)

        route = best.get("route_report") or {}
        if "route" not in lower and "travel" not in lower and route:
            bits = ["", "## Route (evidence)"]
            if route.get("status") == "success":
                bits.append(
                    f"- **Travel:** {route.get('travel_minutes')} min"
                )
                if route.get("google_maps_directions_url"):
                    bits.append(
                        f"- **Directions:** "
                        f"{route.get('google_maps_directions_url')}"
                    )
            elif route.get("status") == "location_required":
                bits.append(
                    "- Share location for live route comparison"
                )
            if len(bits) > 2:
                text = text.rstrip() + "\n" + "\n".join(bits)

        if current.get("name") and "current" not in lower:
            bits = [
                "",
                "## Current venue (evidence)",
                (
                    f"- {current.get('name')}: "
                    f"{current.get('final_score')}/100"
                ),
            ]
            for risk in (current.get("risks") or [])[:5]:
                bits.append(f"- Risk: {risk}")
            text = text.rstrip() + "\n" + "\n".join(bits)

        notice = explorer.get("location_notice")
        if notice and "coordinate" not in lower and "location" not in lower:
            text = text.rstrip() + f"\n\n{notice}"

        chart_payload = None
        if isinstance(chart, dict):
            # Flat MCP shape
            labels = chart.get("labels") or []
            datasets = chart.get("datasets") or []
            # Chart.js nested shape (what the LLM often sends)
            if not labels or not datasets:
                nested = chart.get("data") or {}
                labels = labels or nested.get("labels") or []
                datasets = datasets or nested.get("datasets") or []

            normalized = []
            for ds in datasets:
                if not isinstance(ds, dict):
                    continue
                values = ds.get("values")
                if values is None:
                    values = ds.get("data")  # Chart.js uses "data"
                if values is None:
                    continue
                normalized.append({
                    "label": ds.get("label") or "Final score",
                    "values": values,
                })

            if labels and normalized:
                chart_payload = {
                    "type": chart.get("type") or "bar",
                    "title": chart.get("title") or "Venue scores",
                    "labels": labels,
                    "datasets": normalized,
                }

        mcp = GatherlyMCPClient()
        viz = await mcp.render_visualization(
            markdown=text,
            chart=chart_payload,
            mermaid=None,
        )
        session["visualization"] = viz
        await emit_progress(
            "visualization",
            "completed",
            "Rendered venue comparison visualization via MCP",
            "render_explorer_visualization",
        )
        return _dumps(viz)

    return [
        StructuredTool.from_function(
            coroutine=load_client_event_context,
            name="load_client_event_context",
            description=(
                "Load client event SQL and score venue suitability. "
                "scope: full / suitability / weather / routes. Call first."
            ),
            args_schema=LoadExplorerContextArgs,
        ),
        StructuredTool.from_function(
            coroutine=compare_weather,
            name="compare_weather",
            description=(
                "Compare weather for top venues via MCP Open-Meteo. "
                "Requires load_client_event_context first."
            ),
            args_schema=EmptyArgs,
        ),
        StructuredTool.from_function(
            coroutine=compare_routes,
            name="compare_routes",
            description=(
                "Compare routes to top venues via MCP when browser "
                "location is available. Requires load first."
            ),
            args_schema=EmptyArgs,
        ),
        StructuredTool.from_function(
            coroutine=render_explorer_visualization,
            name="render_explorer_visualization",
            description=(
                "Assemble final scores and render the client-facing answer. "
                "markdown required; optional chart from real final_score values."
            ),
            args_schema=VisualizationArgs,
        ),
    ]
