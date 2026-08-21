from __future__ import annotations

from collections import Counter


async def analyze_logistics(state: dict) -> dict:
    """
    Analyze logistics using the shared RAG context.
    This agent performs no additional retrieval.
    """

    context = state.get("readiness_context", {})

    if context.get("status") != "success":
        return {
            "logistics_report": {
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
    applications = context.get("applications", [])
    hosts = context.get("hosts", [])
    transportation = context.get("transportation", [])
    clothing = context.get("clothing")

    event_metadata = event.get("metadata", {})
    venue_metadata = venue.get("metadata", {})
    clothing_metadata = (
        clothing.get("metadata", {})
        if clothing
        else {}
    )

    guest_count = int(
        event_metadata.get("guest_count") or 0
    )
    venue_capacity = int(
        venue_metadata.get("capacity") or 0
    )

    accessibility_required = bool(
        event_metadata.get("accessibility_required")
    )
    wheelchair_accessible = bool(
        venue_metadata.get("wheelchair_accessible")
    )

    parking_available = bool(
        venue_metadata.get("parking_available")
    )

    transportation_planned = bool(
        event_metadata.get("transportation_planned")
    )

    hosts_needing_ride = [
        application.get("metadata", {}).get("host_id")
        for application in applications
        if application.get(
            "metadata", {}
        ).get("needs_ride")
    ]

    available_transport_seats = sum(
        int(
            plan.get(
                "metadata", {}
            ).get("passenger_count") or 0
        )
        for plan in transportation
    )

    host_by_id = {
        host.get("metadata", {}).get("entity_id"): host
        for host in hosts
    }

    requested_sizes = []

    for application in applications:
        application_metadata = application.get(
            "metadata",
            {},
        )

        if not application_metadata.get("request_dress"):
            continue

        host_id = application_metadata.get("host_id")
        host = host_by_id.get(host_id, {})
        clothing_size = host.get(
            "metadata",
            {},
        ).get("clothing_size")

        if clothing_size:
            requested_sizes.append(clothing_size)

    requested_size_counts = Counter(requested_sizes)
    stock_by_size = clothing_metadata.get(
        "stock_by_size",
        {},
    )

    insufficient_sizes = {}

    for size, requested_quantity in requested_size_counts.items():
        available_quantity = int(
            stock_by_size.get(size, 0)
        )

        if available_quantity < requested_quantity:
            insufficient_sizes[size] = {
                "requested": requested_quantity,
                "available": available_quantity,
            }

    event_type = str(
        event_metadata.get("event_type") or ""
    ).casefold()

    suitable_event_types = {
        str(value).casefold()
        for value in clothing_metadata.get(
            "suitable_event_types",
            [],
        )
    }

    clothing_is_suitable = (
        not clothing
        or not suitable_event_types
        or event_type in suitable_event_types
    )

    risks = []
    recommendations = []

    if not venue:
        risks.append("No venue evidence was found.")
        recommendations.append(
            "Assign and index a venue for this event."
        )

    elif venue_capacity and guest_count > venue_capacity:
        risks.append(
            f"Guest count {guest_count} exceeds venue "
            f"capacity {venue_capacity}."
        )
        recommendations.append(
            "Reduce attendance or choose a larger venue."
        )

    if accessibility_required and not wheelchair_accessible:
        risks.append(
            "The event requires accessibility, but the venue "
            "is not wheelchair accessible."
        )
        recommendations.append(
            "Choose an accessible venue or provide an "
            "approved accessibility arrangement."
        )

    if not parking_available:
        recommendations.append(
            "Inform guests that venue parking is unavailable."
        )

    if transportation_planned and not transportation:
        risks.append(
            "Transportation is required but no plan was found."
        )
        recommendations.append(
            "Create a transportation plan before the event."
        )

    if (
        hosts_needing_ride
        and available_transport_seats
        < len(hosts_needing_ride)
    ):
        shortage = (
            len(hosts_needing_ride)
            - available_transport_seats
        )

        risks.append(
            f"Transportation is short by {shortage} seat(s)."
        )
        recommendations.append(
            "Increase host transportation capacity."
        )

    if requested_sizes and not clothing:
        risks.append(
            "Assigned hosts requested clothing, but no clothing "
            "record was found."
        )
        recommendations.append(
            "Assign an outfit and verify its stock."
        )

    if insufficient_sizes:
        details = ", ".join(
            (
                f"{size}: requested {values['requested']}, "
                f"available {values['available']}"
            )
            for size, values in insufficient_sizes.items()
        )

        risks.append(
            "Insufficient clothing stock: " + details
        )
        recommendations.append(
            "Restock clothing or assign an alternative outfit."
        )

    if clothing and not clothing_is_suitable:
        risks.append(
            "The assigned clothing is not marked as suitable "
            f"for event type {event_metadata.get('event_type')}."
        )
        recommendations.append(
            "Select clothing suitable for the event type."
        )

    return {
        "logistics_report": {
            "status": "success",
            "event_id": context.get("event_id"),
            "guest_count": guest_count,
            "venue_capacity": venue_capacity,
            "accessibility_required": accessibility_required,
            "wheelchair_accessible": wheelchair_accessible,
            "parking_available": parking_available,
            "transportation_planned": transportation_planned,
            "transportation_plans": len(transportation),
            "hosts_needing_ride": len(hosts_needing_ride),
            "available_transport_seats": (
                available_transport_seats
            ),
            "requested_clothing_sizes": dict(
                requested_size_counts
            ),
            "clothing_stock": stock_by_size,
            "insufficient_sizes": insufficient_sizes,
            "clothing_is_suitable": clothing_is_suitable,
            "risks": risks,
            "recommendations": recommendations,
            "sources": (
                [event, venue]
                + transportation
                + ([clothing] if clothing else [])
                + applications
                + hosts
            ),
        }
    }
