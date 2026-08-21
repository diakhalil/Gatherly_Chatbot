"""LangChain tools for the Event Planning Pack specialist."""

from __future__ import annotations

import json
from typing import Any

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, Field

from agent.nodes.shared.event_pack.event_pack_context import (
    collect_event_pack_context,
)
from agent.services.rag_client import ask_rag_ops, extract_answer
from agent.utils.progress import emit_progress
from agent.nodes.shared.event_pack.workbook_builder import build_workbook


class EventIdArgs(BaseModel):
    event_id: int = Field(..., description="Gatherly event ID.")


class OpsGuideArgs(BaseModel):
    question: str = Field(
        ...,
        description=(
            "Retrieval question YOU write from the user's request. "
            "One topic per call. Do not invent a default country or custom. "
            "For arabic_traditions, include only the country/region and custom "
            "the user named. For other topics, include only the angle they named."
        ),
    )
    topics: list[str] = Field(
        ...,
        description=(
            "Exactly one of: organizer, checklist, sustainable, "
            "arabic_traditions. Only the topic the user asked for."
        ),
    )


class GuideRow(BaseModel):
    topic: str = Field(default="", description="Short row label.")
    detail: str = Field(..., description="One practical sentence for the workbook.")


class GuideSection(BaseModel):
    title: str = Field(..., description="Worksheet title from the user's request.")
    rows: list[GuideRow] = Field(default_factory=list)


class ExportWorkbookArgs(BaseModel):
    sheets: list[str] = Field(
        default_factory=list,
        description="Optional. Event/team/guide sheets are auto-built if omitted.",
    )
    guide_sections: list[GuideSection] = Field(
        default_factory=list,
        description=(
            "Required when the user asked for guide topics. "
            "YOU write synthesized rows from search_ops_guides. "
            "Do not paste raw retrieval text. 4-8 rows per section."
        ),
    )


def _dumps(payload: Any) -> str:
    return json.dumps(payload, default=str)


def build_event_pack_tools(session: dict, role: str, user_id: int) -> list:
    async def load_event_pack_context(event_id: int) -> str:
        """Load this event's Gatherly SQL facts. Call first."""
        await emit_progress(
            "sql_context",
            "running",
            "Loading event, venue, hosts and clothing from SQL",
            "event_ops_workbook_agent",
        )
        context = collect_event_pack_context(
            event_id=event_id,
            role=role,
            user_id=user_id,
        )
        session["event_id"] = event_id
        session["context"] = context
        status = "completed" if context.get("status") == "success" else "failed"
        await emit_progress(
            "sql_context",
            status,
            context.get("message") or "Loaded event pack context",
            "event_ops_workbook_agent",
        )
        return _dumps(context)

    async def search_ops_guides(question: str, topics: list[str]) -> str:
        """Search ops guides (organizer/checklist/sustainable/Arabic)."""
        ctx = session.get("context") or {}
        if ctx.get("status") != "success":
            return _dumps({
                "status": "error",
                "message": "Load event pack context before searching guides.",
            })

        clean_topics = [
            str(topic).strip().lower()
            for topic in (topics or [])
            if str(topic).strip()
        ]
        allowed = {"organizer", "checklist", "sustainable", "arabic_traditions"}
        clean_topics = [t for t in clean_topics if t in allowed]
        if not clean_topics:
            return _dumps({
                "status": "error",
                "message": "topics must include at least one valid guide topic.",
            })

        await emit_progress(
            "rag",
            "running",
            f"Searching ops guides: {', '.join(clean_topics)}",
            "event_ops_workbook_agent",
        )

        try:
            raw = await ask_rag_ops(question, clean_topics)
        except Exception as error:
            await emit_progress(
                "rag",
                "failed",
                "Ops guide search failed",
                "event_ops_workbook_agent",
            )
            return _dumps({
                "status": "error",
                "message": str(error),
            })

        if raw.get("status") != "success":
            await emit_progress(
                "rag",
                "failed",
                raw.get("message") or "No ops guide passages found",
                "event_ops_workbook_agent",
            )
            return _dumps(raw)

        source_files = sorted({
            str(src.get("file_name") or "").strip()
            for src in (raw.get("text_sources") or [])
            if str(src.get("file_name") or "").strip()
        })
        entry = {
            "status": "success",
            "topics": clean_topics,
            "question": question,
            "answer": extract_answer(raw),
            "source_files": source_files,
            "text_sources": raw.get("text_sources") or [],
        }
        session.setdefault("ops_guides", []).append(entry)
        await emit_progress(
            "rag",
            "completed",
            f"Found ops guide passages ({', '.join(clean_topics)})",
            "event_ops_workbook_agent",
        )
        return _dumps(entry)


    async def export_planning_workbook(
        sheets: list[str] | None = None,
        guide_sections: list[GuideSection] | None = None,
    ) -> str:
        """Build and export the planning pack as an Excel file."""
        ctx = session.get("context") or {}
        if ctx.get("status") != "success":
            return _dumps({
                "status": "error",
                "message": "Load event pack context before exporting.",
            })

        await emit_progress(
            "export",
            "running",
            "Building Excel workbook",
            "event_ops_workbook_agent",
        )

        ops_guides = session.get("ops_guides") or []

        normalized_sheets = ["event", "team"]
        for guide in ops_guides:
            for topic in (guide.get("topics") or []):
                t = str(topic).strip().lower()
                if t and t not in normalized_sheets:
                    normalized_sheets.append(t)

        for s in (sheets or []):
            key = str(s).strip().lower()
            if key and key not in normalized_sheets:
                normalized_sheets.append(key)

        sections_payload = []
        for section in (guide_sections or []):
            if isinstance(section, GuideSection):
                title = section.title
                raw_rows = section.rows or []
            elif isinstance(section, dict):
                title = section.get("title") or "Guide"
                raw_rows = section.get("rows") or []
            else:
                continue
            rows = []
            for row in raw_rows:
                if isinstance(row, GuideRow):
                    rows.append({"topic": row.topic, "detail": row.detail})
                elif isinstance(row, dict):
                    rows.append({
                        "topic": row.get("topic") or "",
                        "detail": row.get("detail") or "",
                    })
            sections_payload.append({"title": title, "rows": rows})

        try:
            result = build_workbook(
                context=ctx,
                ops_guides=ops_guides,
                sheets=normalized_sheets,
                event_id=session.get("event_id"),
                guide_sections=sections_payload,
            )
        except Exception as error:
            await emit_progress(
                "export",
                "failed",
                "Excel export failed",
                "event_ops_workbook_agent",
            )
            return _dumps({
                "status": "error",
                "message": str(error),
            })

        session["workbook_path"] = result["path"]
        session["workbook_filename"] = result["filename"]
        await emit_progress(
            "export",
            "completed",
            "Excel workbook ready for download",
            "event_ops_workbook_agent",
        )
        return _dumps({
            "status": "success",
            "filename": result["filename"],
            "download_url": result["download_url"],
            "sheets_included": result["sheets_included"],
        })



    return [
        StructuredTool.from_function(
            coroutine=load_event_pack_context,
            name="load_event_pack_context",
            description=(
                "Load SQL facts for one event (title, type, dates, guests, "
                "venue, clothing, accepted hosts). Call first."
            ),
            args_schema=EventIdArgs,
        ),
        StructuredTool.from_function(
            coroutine=search_ops_guides,
            name="search_ops_guides",
            description=(
                "After load_event_pack_context, search non-theme ops guides. "
                "YOU write the question from the user request. "
                "Call once per topic. Never invent a default country or custom."
            ),
            args_schema=OpsGuideArgs,
        ),

        StructuredTool.from_function(
            coroutine=export_planning_workbook,
            name="export_planning_workbook",
            description=(
                "After SQL + guides, export Excel. Pass guide_sections with "
                "YOUR synthesized rows. Do not dump raw retrieval text."
            ),
            args_schema=ExportWorkbookArgs,
        ),
    ]
