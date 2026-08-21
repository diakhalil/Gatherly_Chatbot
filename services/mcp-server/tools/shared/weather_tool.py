from __future__ import annotations

from datetime import date, datetime, timedelta

import httpx


def get_event_weather(
    latitude: float,
    longitude: float,
    event_date: str,
) -> dict:
    """
    Get forecast or historical weather for an event location.

    Forecasts are available for today through the next 16 days.
    Past dates use Open-Meteo's historical archive.
    """

    try:
        target_date = datetime.fromisoformat(
            event_date.replace("Z", "+00:00")
        ).date()
    except (TypeError, ValueError, AttributeError):
        return {
            "status": "invalid_request",
            "message": "event_date must be a valid ISO date or datetime.",
        }

    today = date.today()

    if target_date > today + timedelta(days=16):
        return {
            "status": "forecast_unavailable",
            "event_date": target_date.isoformat(),
            "message": (
                "The event is more than 16 days away. "
                "A reliable forecast is not available yet."
            ),
        }

    is_historical = target_date < today

    if is_historical:
        url = "https://archive-api.open-meteo.com/v1/archive"
    else:
        url = "https://api.open-meteo.com/v1/forecast"

    daily_fields = [
        "temperature_2m_max",
        "temperature_2m_min",
        "precipitation_sum",
        "wind_speed_10m_max",
    ]

    if not is_historical:
        daily_fields.append("precipitation_probability_max")

    params = {
        "latitude": latitude,
        "longitude": longitude,
        "start_date": target_date.isoformat(),
        "end_date": target_date.isoformat(),
        "daily": ",".join(daily_fields),
        "timezone": "Asia/Beirut",
    }

    try:
        response = httpx.get(
            url,
            params=params,
            timeout=20,
        )
        response.raise_for_status()
        data = response.json()
    except (httpx.HTTPError, ValueError) as error:
        return {
            "status": "service_unavailable",
            "message": f"Weather service failed: {error}",
        }

    daily = data.get("daily", {})

    def first(field: str):
        values = daily.get(field, [])
        return values[0] if values else None

    return {
        "status": "success",
        "weather_type": (
            "historical"
            if is_historical
            else "forecast"
        ),
        "event_date": target_date.isoformat(),
        "latitude": latitude,
        "longitude": longitude,
        "temperature_max_c": first("temperature_2m_max"),
        "temperature_min_c": first("temperature_2m_min"),
        "precipitation_mm": first("precipitation_sum"),
        "precipitation_probability": first(
            "precipitation_probability_max"
        ),
        "maximum_wind_kmh": first("wind_speed_10m_max"),
    }
