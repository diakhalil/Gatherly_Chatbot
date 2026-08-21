from __future__ import annotations

from urllib.parse import urlencode

import httpx


def calculate_route(
    origin_latitude: float,
    origin_longitude: float,
    destination_latitude: float,
    destination_longitude: float,
    travel_mode: str = "driving",
) -> dict:
    """
    Calculate a live route using the public OSRM routing service.
    """

    if travel_mode != "driving":
        return {
            "status": "unsupported_mode",
            "message": "The current routing service supports driving only.",
        }

    coordinates = (
        origin_latitude,
        origin_longitude,
        destination_latitude,
        destination_longitude,
    )

    if not all(isinstance(value, (int, float)) for value in coordinates):
        return {
            "status": "invalid_coordinates",
            "message": "All coordinates must be numeric.",
        }

    if not (
        -90 <= origin_latitude <= 90
        and -90 <= destination_latitude <= 90
        and -180 <= origin_longitude <= 180
        and -180 <= destination_longitude <= 180
    ):
        return {
            "status": "invalid_coordinates",
            "message": "One or more coordinates are outside valid ranges.",
        }

    url = (
        "https://router.project-osrm.org/route/v1/driving/"
        f"{origin_longitude},{origin_latitude};"
        f"{destination_longitude},{destination_latitude}"
    )

    try:
        response = httpx.get(
            url,
            params={
                "overview": "false",
                "steps": "false",
                "alternatives": "false",
            },
            timeout=20,
        )
        response.raise_for_status()
        payload = response.json()
    except (httpx.HTTPError, ValueError) as error:
        return {
            "status": "service_unavailable",
            "message": f"Routing service failed: {error}",
        }

    routes = payload.get("routes", [])

    if not routes:
        return {
            "status": "route_not_found",
            "message": "No driving route was found.",
        }

    route = routes[0]

    map_query = urlencode({
        "api": 1,
        "origin": f"{origin_latitude},{origin_longitude}",
        "destination": (
            f"{destination_latitude},{destination_longitude}"
        ),
        "travelmode": travel_mode,
    })

    return {
        "status": "success",
        "travel_mode": travel_mode,
        "distance_km": round(route["distance"] / 1000, 1),
        "duration_minutes": round(route["duration"] / 60),
        "origin": {
            "latitude": origin_latitude,
            "longitude": origin_longitude,
        },
        "destination": {
            "latitude": destination_latitude,
            "longitude": destination_longitude,
        },
        "map_url": (
            "https://www.google.com/maps/dir/?"
            f"{map_query}"
        ),
        "provider": "OSRM",
    }
