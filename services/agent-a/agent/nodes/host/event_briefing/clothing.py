from __future__ import annotations


def analyze_host_clothing(context: dict) -> dict:
    if context.get("status") != "success":
        return {
            "status": context.get("status", "error"),
            "message": context.get("message"),
        }

    assignment = context.get("assignment") or {}
    host = context.get("host") or {}
    clothing = context.get("clothing") or {}

    assignment_meta = assignment.get("metadata", {})
    host_meta = host.get("metadata", {})
    clothing_meta = clothing.get("metadata", {})

    requested_clothing = bool(
        assignment_meta.get("request_dress")
    )
    host_size = host_meta.get("clothing_size")
    stock_by_size = clothing_meta.get("stock_by_size", {})

    available_quantity = (
        stock_by_size.get(host_size)
        if host_size
        else None
    )

    risks = []
    recommendations = []

    if requested_clothing and not clothing:
        risks.append(
            "A clothing item was requested, but no event outfit was found."
        )

    if requested_clothing and not host_size:
        risks.append(
            "Your clothing size is missing from your private host profile."
        )
        recommendations.append(
            "Update your clothing size before confirming the outfit."
        )

    if (
        requested_clothing
        and host_size
        and available_quantity is not None
        and available_quantity <= 0
    ):
        risks.append(
            f"The required outfit is out of stock in size {host_size}."
        )
        recommendations.append(
            "Contact the event administrator for an alternative outfit."
        )

    if (
        requested_clothing
        and available_quantity is not None
        and available_quantity > 0
    ):
        recommendations.append(
            f"Confirm reservation of size {host_size}; "
            f"snapshot stock is {available_quantity}."
        )

    return {
        "status": "success",
        "event_id": context["event_id"],
        "requested_clothing": requested_clothing,
        "host_size": host_size,
        "available_quantity": available_quantity,
        "is_available": (
            available_quantity is not None
            and available_quantity > 0
        ),
        "clothing": {
            "record_id": clothing.get("record_id"),
            "description": clothing.get("text"),
            "image_url": clothing.get("image_url"),
            "stock_by_size": stock_by_size,
        } if clothing else None,
        "risks": risks,
        "recommendations": recommendations,
        "source_records": [
            record
            for record in [
                assignment.get("record_id"),
                host.get("record_id"),
                clothing.get("record_id"),
            ]
            if record
        ],
    }

