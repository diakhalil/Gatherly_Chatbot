from __future__ import annotations

from datetime import datetime, timedelta

from agent.services.mcp_tools import GatherlyMCPClient


async def analyze_host_route(
    context: dict,
    timeline: dict,
    origin_latitude: float,
    origin_longitude: float,
) -> dict:
    if context.get("status") != "success":
        return {
            "status": context.get("status", "error"),
            "message": context.get("message"),
        }

    if timeline.get("status") != "success":
        return {
            "status": "timeline_unavailable",
            "message": "A valid timeline is required.",
        }

    venue = context.get("venue")
    if not venue:
        return {
            "status": "venue_not_found",
            "message": "The event venue was not found.",
        }

    venue_meta = venue.get("metadata", {})
    destination_latitude = venue_meta.get("latitude")
    destination_longitude = venue_meta.get("longitude")

    if destination_latitude is None or destination_longitude is None:
        return {
            "status": "venue_coordinates_missing",
            "message": "The venue has no coordinates.",
        }

    mcp = GatherlyMCPClient()
    route = await mcp.calculate_route(
        origin_latitude=origin_latitude,
        origin_longitude=origin_longitude,
        destination_latitude=destination_latitude,
        destination_longitude=destination_longitude,
    )

    if route.get("status") != "success":
        return route

    required_arrival = datetime.fromisoformat(timeline["required_arrival"])
    travel_minutes = int(route["duration_minutes"])
   
    suggested_departure = required_arrival - timedelta(minutes=travel_minutes)

    return {
        "status": "success",
        "event_id": context["event_id"],
        "distance_km": route["distance_km"],
        "travel_minutes": travel_minutes,
        "departure_buffer_minutes": 0,
        "required_arrival": timeline["required_arrival"],
        "suggested_departure": suggested_departure.isoformat(
            sep=" ",
            timespec="minutes",
        ),
        "map_url": route["map_url"],
        "provider": route["provider"],
        "destination": route["destination"],
        "venue_record": venue.get("record_id"),
    }
