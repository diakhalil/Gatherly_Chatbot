from __future__ import annotations

import logging
import os
from pathlib import Path

from google.adk.agents import Agent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from agent.prompts import build_invitation_instruction

logger = logging.getLogger("agent-b.adk")


DEFAULT_MODEL = "gemini-3.5-flash-lite"


def _safe_path(project_root: Path, relative_path: str) -> Path:
    root = project_root.resolve()
    target = (root / relative_path).resolve()
    if root not in target.parents and target != root:
        raise ValueError("Path escapes project root")
    return target


def build_tools(project_root: Path,report_progress=None):
    def emit(tool: str, message: str) -> None:
        if report_progress:
            report_progress({
                "step": "tool",
                "tool": tool,
                "message": message,
            })

    def list_files() -> dict:
        """List source files in the invitation project."""
        emit("list_files", "Listing project files")
        files = []
        for path in project_root.rglob("*"):
            if path.is_file() and "node_modules" not in path.parts and "dist" not in path.parts:
                files.append(str(path.relative_to(project_root)).replace("\\", "/"))
        logger.info("tool list_files -> %d files", len(files))
        return {"files": sorted(files)}

    def read_file(relative_path: str) -> dict:
        """Read a text file relative to the project root."""
        emit("read_file", f"Reading {relative_path}")
        path = _safe_path(project_root, relative_path)
        logger.info("tool read_file %s", relative_path)
        return {"path": relative_path, "content": path.read_text(encoding="utf-8")}

    def write_file(relative_path: str, content: str) -> dict:
        """Create or overwrite a text file relative to the project root."""
        emit("write_file", f"Writing {relative_path}")
        path = _safe_path(project_root, relative_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        logger.info("tool write_file %s (%d chars)", relative_path, len(content))
        return {"status": "written", "path": relative_path}

    return [list_files, read_file, write_file]


async def generate_invitation_site(project_root: Path, include_router_pages: bool = False,report_progress=None,) -> str:
    model = os.getenv("AGENT_B_MODEL", DEFAULT_MODEL)
    event_data = (project_root / "src" / "eventData.js").read_text(encoding="utf-8")
    shell_app = (project_root / "src" / "App.jsx").read_text(encoding="utf-8")

    agent = Agent(
        name="invitation_site_builder",
        model=model,
        instruction=build_invitation_instruction(include_router_pages),
        tools=build_tools(project_root,report_progress),
        generate_content_config=types.GenerateContentConfig(
            thinking_config=types.ThinkingConfig(thinking_level="minimal"),
        ),
    )
    session_service = InMemorySessionService()
    runner = Runner(agent=agent, app_name="gatherly_agent_b", session_service=session_service)
    session = await session_service.create_session(app_name="gatherly_agent_b", user_id="system")

    user_message = types.Content(
        role="user",
        parts=[types.Part(text=(
            f"Build the invitation website in: {project_root}\n\n"
            "eventData.js (already on disk — import it, do not rewrite unless broken):\n"
            f"```js\n{event_data}\n```\n\n"
            "Current App.jsx stub:\n"
            f"```jsx\n{shell_app}\n```\n\n"
            "Write src/App.jsx and src/styles.css now (complete files), then DONE."
        ))],
    )

    logger.info("ADK generate start model=%s project=%s", model, project_root)
    final_text = ""
    async for event in runner.run_async(
        user_id="system",
        session_id=session.id,
        new_message=user_message,
    ):
        if event.content and event.content.parts:
            for part in event.content.parts:
                if getattr(part, "text", None):
                    final_text = part.text
                    logger.info("ADK text chunk (%d chars)", len(part.text))
    logger.info("ADK generate done")
    return final_text or "Invitation site generation finished."
