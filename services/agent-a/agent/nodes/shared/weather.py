from __future__ import annotations

from agent.services.mcp_tools import GatherlyMCPClient

async def analyze_venue_weather(
    *,
    mcp: GatherlyMCPClient,
    event_id: int,
    starts_at: str,
    latitude: float,
    longitude: float,
    venue_setting: str | None,
    sources: list[dict] | None = None,
) -> dict:
    """Analyze weather for an event venue using MCP weather tool."""
    weather = await mcp.check_weather(
        latitude=float(latitude),
        longitude=float(longitude),
        event_date=starts_at,
    )

    if weather.get("status") != "success":
        return {
            "status": weather.get("status", "unavailable"),
            "event_id": event_id,
            "venue_setting": venue_setting,
            "weather_score": None,
            "weather": weather,
            "risks": [
                "Weather data is currently unavailable."
            ],
            "recommendations": [
                "Check the forecast again before making a final decision."
            ],
            "sources": sources or [],
        }

    risks = []
    recommendations = []

    rain_probability = weather.get(
        "precipitation_probability"
    )
    rain_amount = weather.get("precipitation_mm")
    maximum_wind = weather.get("maximum_wind_kmh")
    maximum_temperature = weather.get("temperature_max_c")
    minimum_temperature = weather.get("temperature_min_c")

    significant_rain = (
        (
            rain_probability is not None
            and rain_probability >= 60
        )
        or (
            rain_amount is not None
            and rain_amount >= 5
        )
    )

    if significant_rain:
        risks.append("Significant rain is possible.")

        if venue_setting in {"outdoor", "mixed"}:
            recommendations.append(
                "Prepare a covered or indoor backup area."
            )

    if maximum_wind is not None and maximum_wind >= 35:
        risks.append(
            "Strong wind may affect outdoor equipment."
        )
        recommendations.append(
            "Secure decorations, signs and temporary structures."
        )

    if (
        maximum_temperature is not None
        and maximum_temperature >= 34
    ):
        risks.append(
            "High temperature may affect guests and hosts."
        )
        recommendations.append(
            "Provide water, shade and cooling breaks."
        )

    if (
        minimum_temperature is not None
        and minimum_temperature <= 5
    ):
        risks.append(
            "Low temperature may affect outdoor comfort."
        )
        recommendations.append(
            "Provide heating or move activities indoors."
        )

    weather_score = 100

    if significant_rain:
        if venue_setting == "outdoor":
            weather_score -= 40
        elif venue_setting == "mixed":
            weather_score -= 20
        else:
            weather_score -= 5

    if maximum_wind is not None and maximum_wind >= 35:
        weather_score -= (
            25 if venue_setting in {"outdoor", "mixed"} else 5
        )

    if (
        maximum_temperature is not None
        and maximum_temperature >= 34
    ):
        weather_score -= (
            20 if venue_setting in {"outdoor", "mixed"} else 5
        )

    return {
        "status": weather.get("status", "unknown"),
        "event_id": event_id,
        "venue_setting": venue_setting,
        "weather_score": max(0, weather_score),
        "weather": weather,
        "risks": risks,
        "recommendations": recommendations,
        "sources": sources or [],
    }

async def analyze_event_weather(state: dict) -> dict:
    """
    Analyze weather risk using the shared SQL context.
    This agent only calls the MCP weather tool.
    """

    context = (
        state.get("event_context")
        or state.get("readiness_context")
        or state.get("briefing_context")
        or {}
    )

    if context.get("status") != "success":
        return {
            "weather_report": {
                "status": "missing_context",
                "risks": [],
                "recommendations": [],
                "message": (
                    "A valid readiness context was not provided."
                ),
            }
        }

    event = context.get("event") or {}
    venue = context.get("venue") or {}

    event_metadata = event.get("metadata", {})
    venue_metadata = venue.get("metadata", {})

    event_id = context.get("event_id")
    latitude = event_metadata.get("latitude")
    longitude = event_metadata.get("longitude")
    starts_at = event_metadata.get("starts_at")
    venue_setting = venue_metadata.get("indoor_outdoor")

    if latitude is None or longitude is None or not starts_at:
        return {
            "weather_report": {
                "status": "missing_event_data",
                "event_id": event_id,
                "risks": [],
                "recommendations": [],
                "message": (
                    "The shared context does not contain "
                    "coordinates or an event date."
                ),
            }
        }

    mcp = GatherlyMCPClient()

    weather_report = await analyze_venue_weather(
        mcp=mcp,
        event_id=event_id,
        starts_at=starts_at,
        latitude=float(latitude),
        longitude=float(longitude),
        venue_setting=venue_setting,
        sources=[event, venue],
    )

    return {
        "weather_report": weather_report,
    }
