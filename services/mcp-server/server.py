from fastmcp import FastMCP
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from fastmcp.server.auth.providers.jwt import StaticTokenVerifier

SERVICE_ROOT = Path(__file__).resolve().parent
REPO_ROOT = SERVICE_ROOT.parents[1]

if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from tools.shared.weather_tool import get_event_weather
from tools.shared.route_tool import calculate_route
from tools.shared.visualization_tool import (
    render_visualization as build_visualization,
)

load_dotenv(REPO_ROOT / ".env")
load_dotenv(SERVICE_ROOT / ".env")

mcp_api_token = os.getenv("MCP_API_TOKEN")

if not mcp_api_token:
    raise ValueError("MCP_API_TOKEN is missing")

token_verifier = StaticTokenVerifier(
    tokens={
        mcp_api_token: {
            "client_id": "gatherly-client",
            "scopes": ["tools:read"],
        }
    },
    required_scopes=["tools:read"],
)

mcp = FastMCP("Gatherly Tools Server", auth=token_verifier)


@mcp.tool
def check_event_weather(
    latitude: float,
    longitude: float,
    event_date: str,
) -> dict:
    """
    Get forecast or historical weather for an event location.
    Forecasts are limited to the next 16 days.
    """
    return get_event_weather(
        latitude=latitude,
        longitude=longitude,
        event_date=event_date,
    )


@mcp.tool
def calculate_event_route(
    origin_latitude: float,
    origin_longitude: float,
    destination_latitude: float,
    destination_longitude: float,
    travel_mode: str = "driving",
) -> dict:
    """
    Calculate live route distance and travel time to a venue.
    """
    return calculate_route(
        origin_latitude=origin_latitude,
        origin_longitude=origin_longitude,
        destination_latitude=destination_latitude,
        destination_longitude=destination_longitude,
        travel_mode=travel_mode,
    )


@mcp.tool
def render_visualization(
    markdown: str,
    chart: dict | None = None,
    mermaid: str | None = None,
) -> dict:
    """
    Render a visualization for the user from markdown plus optional chart
    and/or Mermaid diagram.

    Use whenever a chart or diagram helps (scores, comparisons, timelines,
    readiness, venue ranking, etc.). Do not invent data — only pass values
    you already retrieved from other tools.

    Args:
        markdown: User-facing markdown summary (headings, bullets, tables).
        chart: Optional QuickChart spec:
            {
              "type": "bar" | "line" | "pie" | "radar" | "doughnut",
              "title": "optional title",
              "labels": ["A", "B"],
              "datasets": [{"label": "Score", "values": [80, 65]}]
            }
            Omit when you only want markdown/Mermaid.
        mermaid: Optional Mermaid source (timeline, flowchart, etc.).
            Omit when you only want markdown/chart.

    Returns:
        { "status", "markdown", "image_url", "mermaid" }
        image_url / mermaid may be null.
    """
    return build_visualization(
        markdown=markdown,
        chart=chart,
        mermaid=mermaid,
    )



if __name__ == "__main__":
    mcp.run(
        transport="http",
        host="0.0.0.0",
        port=8000,
    )
