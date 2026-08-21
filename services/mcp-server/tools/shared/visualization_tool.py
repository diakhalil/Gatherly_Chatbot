"""Build markdown + optional chart image + optional Mermaid diagram."""

from __future__ import annotations

import json
from typing import Any
from urllib.parse import quote


def render_visualization(
    markdown: str,
    chart: dict[str, Any] | None = None,
    mermaid: str | None = None,
) -> dict[str, Any]:
    """
    Return user-facing markdown, an optional chart image URL, and optional Mermaid.

    chart example:
    {
      "type": "bar",
      "title": "Venue scores",
      "labels": ["A", "B"],
      "datasets": [{"label": "Score", "values": [80, 65]}]
    }

    mermaid example:
    timeline
        title Day plan
        section Venue
            Arrive : 15:00
            Event starts : 16:00
    """
    markdown = (markdown or "").strip()
    mermaid_text = (mermaid or "").strip() or None
    image_url = None

    if chart and isinstance(chart, dict):
        chart_type = chart.get("type") or "bar"
        labels = chart.get("labels") or []
        datasets_in = chart.get("datasets") or []
        title = chart.get("title") or ""

        datasets = []
        for item in datasets_in:
            if not isinstance(item, dict):
                continue
            datasets.append({
                "label": item.get("label") or "Series",
                "data": item.get("values") or item.get("data") or [],
            })

        config = {
            "type": chart_type,
            "data": {
                "labels": labels,
                "datasets": datasets,
            },
            "options": {
                "plugins": {
                    "title": {
                        "display": bool(title),
                        "text": title,
                    },
                    "legend": {"display": len(datasets) > 1},
                },
            },
        }

        image_url = (
            "https://quickchart.io/chart?c="
            + quote(json.dumps(config, separators=(",", ":")))
        )

    parts: list[str] = []
    if markdown:
        parts.append(markdown)
    if mermaid_text:
        parts.append("```mermaid\n" + mermaid_text + "\n```")

    return {
        "status": "success",
        "markdown": "\n\n".join(parts),
        "image_url": image_url,
        "mermaid": mermaid_text,
    }