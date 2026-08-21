from __future__ import annotations


def calculate_readiness_score(
    weather_report: dict,
    staffing_report: dict,
    logistics_report: dict,
) -> dict:
    """
    Calculate a consistent readiness score from structured reports.

    The LLM does not invent the score. Every deduction is recorded
    so the result is explainable and repeatable.
    """

    score = 100
    deductions = []

    def deduct(category: str, reason: str, points: int):
        nonlocal score

        if points <= 0:
            return

        score -= points
        deductions.append({
            "category": category,
            "reason": reason,
            "points": points,
        })

    weather_risks = weather_report.get("risks", [])

    if weather_risks:
        deduct(
            "weather",
            f"{len(weather_risks)} weather risk(s) detected",
            min(len(weather_risks) * 8, 24),
        )

    shortage = int(
        staffing_report.get("shortage") or 0
    )

    if shortage:
        deduct(
            "staffing",
            f"Short by {shortage} host(s)",
            min(shortage * 10, 30),
        )

    missing_languages = staffing_report.get(
        "missing_languages",
        [],
    )

    if missing_languages:
        deduct(
            "staffing",
            "Missing required languages",
            min(len(missing_languages) * 8, 16),
        )

    missing_skills = staffing_report.get(
        "missing_skills",
        [],
    )

    if missing_skills:
        deduct(
            "staffing",
            "Missing required skills",
            min(len(missing_skills) * 8, 16),
        )

    if not staffing_report.get("has_team_leader", False):
        deduct(
            "staffing",
            "No team leader assigned",
            10,
        )

    inactive_hosts = staffing_report.get(
        "inactive_host_ids",
        [],
    )

    if inactive_hosts:
        deduct(
            "staffing",
            "Inactive hosts are assigned",
            min(len(inactive_hosts) * 10, 20),
        )

    ineligible_hosts = staffing_report.get(
        "ineligible_host_ids",
        [],
    )

    if ineligible_hosts:
        deduct(
            "staffing",
            "Ineligible hosts are assigned",
            min(len(ineligible_hosts) * 10, 20),
        )

    guest_count = int(
        logistics_report.get("guest_count") or 0
    )
    venue_capacity = int(
        logistics_report.get("venue_capacity") or 0
    )

    if (
        venue_capacity
        and guest_count > venue_capacity
    ):
        deduct(
            "logistics",
            "Guest count exceeds venue capacity",
            25,
        )

    if (
        logistics_report.get("accessibility_required")
        and not logistics_report.get(
            "wheelchair_accessible"
        )
    ):
        deduct(
            "logistics",
            "Accessibility requirement is not satisfied",
            20,
        )

    transportation_planned = logistics_report.get(
        "transportation_planned"
    )
    transportation_plans = int(
        logistics_report.get("transportation_plans") or 0
    )

    if transportation_planned and not transportation_plans:
        deduct(
            "logistics",
            "Required transportation plan is missing",
            15,
        )

    ride_requests = int(
        logistics_report.get("hosts_needing_ride") or 0
    )
    available_seats = int(
        logistics_report.get(
            "available_transport_seats"
        ) or 0
    )

    if ride_requests > available_seats:
        deduct(
            "logistics",
            "Transportation seats are insufficient",
            15,
        )

    if logistics_report.get("insufficient_sizes"):
        deduct(
            "logistics",
            "Clothing stock is insufficient",
            15,
        )

    if not logistics_report.get(
        "clothing_is_suitable",
        True,
    ):
        deduct(
            "logistics",
            "Clothing is unsuitable for the event type",
            10,
        )

    score = max(score, 0)

    if score >= 85:
        level = "ready"
    elif score >= 60:
        level = "needs_attention"
    else:
        level = "high_risk"

    return {
        "score": score,
        "level": level,
        "deductions": deductions,
    }
