from __future__ import annotations

from typing import Any


def score_candidate_venues(
    event: dict[str, Any],
    venues: list[dict[str, Any]],
) -> dict[str, Any]:
    event_metadata = event.get("metadata", {})

    guest_count = int(event_metadata.get("guest_count") or 0)
    event_type = str(
        event_metadata.get("event_type") or ""
    ).lower()
    accessibility_required = bool(
        event_metadata.get("accessibility_required", False)
    )

    scored_venues = []

    for venue in venues:
        capacity = int(venue.get("capacity") or 0)
        description = str(venue.get("description") or "").lower()

        capacity_score = 30 if capacity >= guest_count else 0

        if accessibility_required:
            accessibility_score = (
                25 if venue.get("wheelchair_accessible") else 0
            )
        else:
            accessibility_score = 25

        parking_score = (
            15 if venue.get("parking_available") else 0
        )

        event_type_score = (
            20 if event_type and event_type in description else 0
        )

        setting = venue.get("indoor_outdoor")
        setting_score = 10 if setting in {"indoor", "mixed"} else 7

        total_score = (
            capacity_score
            + accessibility_score
            + parking_score
            + event_type_score
            + setting_score
        )

        risks = []

        if capacity < guest_count:
            risks.append(
                f"Capacity is {capacity}, below the required "
                f"{guest_count} guests."
            )

        if (
            accessibility_required
            and not venue.get("wheelchair_accessible")
        ):
            risks.append(
                "The event requires accessibility, but this venue "
                "is not wheelchair accessible."
            )

        if not venue.get("parking_available"):
            risks.append("Venue parking is unavailable.")

        scored_venues.append({
            **venue,
            "score": total_score,
            "score_breakdown": {
                "capacity": capacity_score,
                "accessibility": accessibility_score,
                "parking": parking_score,
                "event_type_fit": event_type_score,
                "setting_resilience": setting_score,
            },
            "chart_values": {
                "capacity": round(capacity_score / 30 * 100),
                "accessibility": round(
                    accessibility_score / 25 * 100
                ),
                "parking": round(parking_score / 15 * 100),
                "event_type_fit": round(
                    event_type_score / 20 * 100
                ),
                "setting_resilience": round(
                    setting_score / 10 * 100
                ),
            },
            "risks": risks,
            "eligible": (
                capacity >= guest_count
                and (
                    not accessibility_required
                    or venue.get("wheelchair_accessible")
                )
            ),
        })

    scored_venues.sort(
        key=lambda item: (
            item["eligible"],
            item["score"],
        ),
        reverse=True,
    )

    return {
        "status": "success",
        "best_match": scored_venues[0] if scored_venues else None,
        "current_venue": next(
            (
                venue
                for venue in scored_venues
                if venue.get("is_current_venue")
            ),
            None,
        ),
        "ranked_venues": scored_venues,
        "chart_axes": [
            "Capacity",
            "Accessibility",
            "Parking",
            "Event type fit",
            "Setting resilience",
        ],
    }

