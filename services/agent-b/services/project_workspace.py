from __future__ import annotations
import json, shutil
from datetime import datetime, timezone
from pathlib import Path
from schemas.invitation import InvitationGenerateRequest

SERVICE_ROOT = Path(__file__).resolve().parents[1]
SHELL_DIR = SERVICE_ROOT / "templates" / "vite_shell"
OUTPUT_DIR = SERVICE_ROOT / "output"

def create_project(request: InvitationGenerateRequest) -> Path:
    if not SHELL_DIR.exists():
        raise FileNotFoundError(f"Missing shell template: {SHELL_DIR}")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    event_part = request.event_id if request.event_id is not None else "draft"
    target = OUTPUT_DIR / f"invite-{event_part}-{stamp}"
    shutil.copytree(SHELL_DIR, target, ignore=shutil.ignore_patterns("node_modules", "dist"))
    payload = {
        "title": request.title,
        "eventType": request.event_type,
        "startsAt": request.starts_at,
        "venueName": request.venue_name,
        "venueAddress": request.venue_address or "",
        "clientName": request.client_name or "",
        "message": request.message or "",
        "primaryColor": request.primary_color,
        "accentColor": request.accent_color,
        "eventId": request.event_id,
    }
    (target / "src" / "eventData.js").write_text(
        "// Auto-generated event data\n"
        f"export const eventData = {json.dumps(payload, indent=2)};\n",
        encoding="utf-8",
    )
    return target
    