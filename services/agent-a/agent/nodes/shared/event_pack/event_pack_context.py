"""SQL context for the Event Planning Pack specialist."""

from __future__ import annotations

from typing import Any

from agent.db import fetch_all, fetch_one


def _dt(value) -> str | None:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat(sep=" ", timespec="seconds")
    return str(value)


def collect_event_pack_context(
    *,
    event_id: int,
    role: str,
    user_id: int,
) -> dict[str, Any]:
    if role not in {"admin", "client"}:
        return {
            "status": "forbidden",
            "message": "Planning packs are available to admins and clients.",
        }

    event_row = fetch_one(
        """
        SELECT eventId, title, type, description, location,
               startsAt, endsAt, nbOfHosts, nbOfGuests, status,
               clothesId, venueId, clientId
          FROM events
         WHERE eventId = %s
        """,
        (event_id,),
    )
    if not event_row:
        return {
            "status": "event_not_found",
            "message": f"Event {event_id} was not found.",
        }

    if role == "client" and int(event_row.get("clientId") or 0) != int(user_id):
        return {
            "status": "forbidden",
            "message": "That event does not belong to this client.",
        }

    venue = None
    if event_row.get("venueId"):
        venue_row = fetch_one(
            """
            SELECT venueId, name, city, capacity, indoorOutdoor,
                   wheelchairAccessible, parkingAvailable
              FROM venues
             WHERE venueId = %s
            """,
            (event_row["venueId"],),
        )
        if venue_row:
            venue = {
                "name": venue_row.get("name"),
                "city": venue_row.get("city"),
                "capacity": venue_row.get("capacity"),
                "indoor_outdoor": venue_row.get("indoorOutdoor"),
                "wheelchair_accessible": bool(
                    venue_row.get("wheelchairAccessible")
                ),
                "parking_available": bool(venue_row.get("parkingAvailable")),
            }

    clothing = None
    if event_row.get("clothesId"):
        clothing_row = fetch_one(
            """
            SELECT clothesId, clothingLabel, description
              FROM clothing
             WHERE clothesId = %s
            """,
            (event_row["clothesId"],),
        )
        if clothing_row:
            clothing = {
                "label": clothing_row.get("clothingLabel"),
                "description": clothing_row.get("description"),
            }

    host_rows = fetch_all(
        """
        SELECT ea.assignedRole, ea.needsRide, ea.requestDress,
               u.fName, u.lName
          FROM event_app ea
          JOIN users u ON u.userId = ea.senderId
         WHERE ea.eventId = %s
           AND ea.status = 'accepted'
         ORDER BY u.fName, u.lName
        """,
        (event_id,),
    )
    hosts = [
        {
            "name": f"{row.get('fName') or ''} {row.get('lName') or ''}".strip(),
            "role": row.get("assignedRole"),
            "needs_ride": bool(row.get("needsRide")),
            "request_dress": bool(row.get("requestDress")),
        }
        for row in host_rows
    ]

    required = int(event_row.get("nbOfHosts") or 0)
    return {
        "status": "success",
        "event": {
            "event_id": event_row["eventId"],
            "title": event_row.get("title"),
            "type": event_row.get("type"),
            "starts_at": _dt(event_row.get("startsAt")),
            "ends_at": _dt(event_row.get("endsAt")),
            "guest_count": int(event_row.get("nbOfGuests") or 0),
            "required_hosts": required,
            "assigned_hosts": len(hosts),
            "status": event_row.get("status"),
            "location": event_row.get("location"),
        },
        "venue": venue,
        "clothing": clothing,
        "hosts": hosts,
    }
