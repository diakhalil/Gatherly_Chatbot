from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
import asyncio
import json
from fastapi.responses import StreamingResponse

SERVICE_ROOT = Path(__file__).resolve().parents[1]

REPO_ROOT = SERVICE_ROOT.parents[1]
SHARED_LOGGING = REPO_ROOT / "logs" / "shared"

if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))
if str(SHARED_LOGGING) not in sys.path:
    sys.path.insert(0, str(SHARED_LOGGING))

from logging_setup import setup_logging

load_dotenv(REPO_ROOT / ".env")


# google-adk prefers GOOGLE_API_KEY; keep only one to avoid spam warnings.
gemini_key = os.getenv("GEMINI_API_KEY")
google_key = os.getenv("GOOGLE_API_KEY")
if gemini_key and not google_key:
    os.environ["GOOGLE_API_KEY"] = gemini_key
if os.getenv("GOOGLE_API_KEY") and os.getenv("GEMINI_API_KEY"):
    del os.environ["GEMINI_API_KEY"]


setup_logging(
    "agent-b",
    level=logging.INFO,
    also_console=True,
)

logger = logging.getLogger("agent-b.api")

from schemas.invitation import InvitationGenerateRequest, InvitationGenerateResponse
from services.project_workspace import create_project
from agent.adk_app import generate_invitation_site
from services.netlify_deployer import build_and_deploy

app = FastAPI(title="Gatherly Agent System B", version="0.3.0")


@app.get("/health")
def health():
    token_ok = bool(
        (os.getenv("NETLIFY_AUTH_TOKEN") or os.getenv("NETLIFY_TOKEN") or "").strip()
    )
    return {
        "status": "ok",
        "service": "agent-b",
        "netlify_token_configured": token_ok,
    }


@app.post("/v1/invitations/generate", response_model=InvitationGenerateResponse)
async def generate_invitation(request: InvitationGenerateRequest):
    try:
        project_path = create_project(request)
        summary = await generate_invitation_site(
            project_path,
            include_router_pages=request.include_router_pages,
        )
    except FileNotFoundError as error:
        raise HTTPException(status_code=500, detail=str(error)) from error
    except Exception as error:
        logger.exception("Invitation generation failed")
        raise HTTPException(status_code=500, detail=str(error)) from error

    deploy_url = None
    site_id = None
    deploy_status = "skipped"
    deploy_error = None
    message = f'cd "{project_path}" && npm install && npm run dev'

    if request.deploy:
        if not (
            os.getenv("NETLIFY_AUTH_TOKEN") or os.getenv("NETLIFY_TOKEN") or ""
        ).strip():
            deploy_status = "skipped"
            deploy_error = "NETLIFY_AUTH_TOKEN / NETLIFY_TOKEN not set"
            message = (
                f"Site generated at {project_path}. "
                "Deploy skipped — set NETLIFY_TOKEN (or NETLIFY_AUTH_TOKEN) to publish."
            )
        else:
            try:
                stamp = project_path.name
                result = build_and_deploy(
                    project_path,
                    site_name=f"gatherly-{stamp}",
                )
                deploy_url = result.get("deploy_url")
                site_id = result.get("site_id")
                deploy_status = "success"
                message = f"Live invitation: {deploy_url}"
            except Exception as error:
                logger.exception("Netlify deploy failed")
                deploy_status = "failed"
                deploy_error = str(error)
                message = (
                    f"Site generated at {project_path}, but deploy failed: {error}"
                )

    return InvitationGenerateResponse(
        status="success",
        project_path=str(project_path),
        agent_summary=summary,
        message=message,
        deploy_url=deploy_url,
        site_id=site_id,
        deploy_status=deploy_status,
        deploy_error=deploy_error,
    )


@app.post("/v1/invitations/generate/stream")
async def generate_invitation_stream(request: InvitationGenerateRequest):
    queue: asyncio.Queue = asyncio.Queue()
    loop = asyncio.get_running_loop()

    def report_progress(event: dict) -> None:
        # Safe even if an ADK tool executes in another thread.
        loop.call_soon_threadsafe(queue.put_nowait, {
            "type": "progress",
            "data": event,
        })

    async def run_generation() -> None:
        try:
            report_progress({
                "step": "workspace",
                "message": "Creating invitation project",
            })

            project_path = create_project(request)

            report_progress({
                "step": "agent",
                "message": "Starting the invitation coding agent",
            })

            summary = await generate_invitation_site(
                project_path,
                include_router_pages=request.include_router_pages,
                report_progress=report_progress,
            )

            deploy_url = None
            site_id = None
            deploy_status = "skipped"
            deploy_error = None
            message = f'cd "{project_path}" && npm install && npm run dev'

            if request.deploy:
                token = (
                    os.getenv("NETLIFY_AUTH_TOKEN")
                    or os.getenv("NETLIFY_TOKEN")
                    or ""
                ).strip()

                if not token:
                    deploy_error = "Netlify token is not configured"
                    message = (
                        f"Site generated at {project_path}. "
                        "Deployment was skipped."
                    )

                    report_progress({
                        "step": "deployment",
                        "message": "Deployment skipped: Netlify token missing",
                    })
                else:
                    report_progress({
                        "step": "deployment",
                        "message": "Building and deploying invitation",
                    })

                    try:
                        result = await asyncio.to_thread(
                            build_and_deploy,
                            project_path,
                            site_name=f"gatherly-{project_path.name}",
                        )

                        deploy_url = result.get("deploy_url")
                        site_id = result.get("site_id")
                        deploy_status = "success"
                        message = f"Live invitation: {deploy_url}"

                    except Exception:
                        logger.exception("Netlify deployment failed")
                        deploy_status = "failed"
                        deploy_error = "Website deployment failed"
                        message = (
                            f"Site generated at {project_path}, "
                            "but deployment failed."
                        )

            await queue.put({
                "type": "result",
                "data": {
                    "status": "success",
                    "project_path": str(project_path),
                    "agent_summary": summary,
                    "message": message,
                    "deploy_url": deploy_url,
                    "site_id": site_id,
                    "deploy_status": deploy_status,
                    "deploy_error": deploy_error,
                },
            })

        except Exception:
            logger.exception("Streaming invitation generation failed")

            await queue.put({
                "type": "error",
                "data": {
                    "message": "Invitation generation failed.",
                },
            })

        finally:
            await queue.put({"type": "done"})

    async def event_stream():
        task = asyncio.create_task(run_generation())

        try:
            while True:
                event = await queue.get()

                if event["type"] == "done":
                    break

                yield f"data: {json.dumps(event, default=str)}\n\n"

        finally:
            if not task.done():
                task.cancel()

            await asyncio.gather(task, return_exceptions=True)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
