from __future__ import annotations

from pydantic import BaseModel, Field


class InvitationGenerateRequest(BaseModel):
    event_id: int | None = None
    title: str = Field(..., min_length=1)
    event_type: str = "Event"
    starts_at: str
    venue_name: str = "TBA"
    venue_address: str | None = None
    client_name: str | None = None
    message: str | None = None
    primary_color: str = "#a26769"
    accent_color: str = "#f7f3ef"
    include_router_pages: bool = False
    # When true, npm build + Netlify deploy (requires NETLIFY_AUTH_TOKEN + Node).
    deploy: bool = True


class InvitationGenerateResponse(BaseModel):
    status: str
    project_path: str
    agent_summary: str
    message: str
    deploy_url: str | None = None
    site_id: str | None = None
    deploy_status: str | None = None
    deploy_error: str | None = None
