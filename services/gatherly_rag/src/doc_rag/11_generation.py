"""Answer generation via OpenRouter (OpenAI-compatible)."""

from __future__ import annotations

import os
from typing import Any

from dotenv import load_dotenv
from openai import OpenAI

from pathlib import Path
from dotenv import load_dotenv

_ROOT = Path(__file__).resolve().parents[4] 
load_dotenv(_ROOT / ".env")

DEFAULT_LLM_MODEL = "gemini-3.5-flash"
# OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434/v1")
# DEFAULT_LLM_MODEL = "qwen2.5:7b"


def get_llm_client() -> OpenAI:
    key = os.getenv("GEMINI_API_KEY")
    if not key:
        raise RuntimeError("GEMINI_API_KEY is missing from .env")
    return OpenAI(
        base_url="https://generativelanguage.googleapis.com/v1beta/openai/",
        api_key=key,
    )

# def get_llm_client() -> OpenAI:
#     """Local Ollama — api_key is required by the OpenAI SDK but ignored by Ollama."""
#     return OpenAI(
#         base_url=OLLAMA_BASE_URL,
#         api_key=os.getenv("OLLAMA_API_KEY", "ollama"),
#     )


def build_rag_messages(
    query: str,
    contexts: list[dict[str, Any]],
    image_contexts: list[dict[str, Any]] | None = None,
) -> list[dict[str, str]]:
    blocks = []
    text_n = 0
    image_n = 0

    for ctx in contexts:
        text_n += 1
        file_name = ctx.get("file_name", "?")
        page = ctx.get("page_number", "?")
        text = str(ctx.get("text", "")).strip()
        section = str(ctx.get("section_title") or "").strip()
        header = f"[T{text_n}] DOCUMENT TEXT | {file_name} (page {page})"
        if section:
            header += f" | section: {section}"
        blocks.append(f"{header}\n{text}")

    image_contexts = image_contexts or []
    for ctx in image_contexts:
        image_n += 1
        file_name = ctx.get("file_name", "?")
        pages = ctx.get("page_numbers") or ctx.get("page_number") or "?"
        section = str(ctx.get("section_title") or "").strip()
        visual = str(ctx.get("visual_description") or "").strip()
        nearby = str(
            ctx.get("nearby_text")
            or ctx.get("local_context")
            or ctx.get("context_text")
            or ""
        ).strip()
        image_id = ctx.get("image_id", "?")
        parts = [
            f"[I{image_n}] IMAGE METADATA | id={image_id} | {file_name} | pages {pages}"
        ]
        if section:
            parts.append(f"Section/heading: {section}")
        if nearby:
            parts.append(f"Linked document context (use this to EXPLAIN):\n{nearby}")
        if visual:
            parts.append(
                "Visual appearance notes (supporting detail only — "
                "do NOT paste this as the full answer):\n"
                f"{visual}"
            )
        if not nearby and not visual:
            parts.append("(no linked text or visual notes)")
        blocks.append("\n".join(parts))

    context_block = "\n\n".join(blocks) if blocks else "(no context retrieved)"

    system = (
        "You are Gatherly's event-planning assistant.\n"
        "Answer from the provided context.\n\n"
        "How to answer:\n"
        "- Write a clear explanation that helps the user plan or understand the topic.\n"
        "- Prefer DOCUMENT TEXT [T…] and each image's linked document context.\n"
        "- Images support the answer; do not only paste visual appearance notes.\n"
        "- Name venues, places, tips, or facts only if they appear in the context.\n"
        "- Keep the answer concise (short intro + a few bullets is fine).\n"
        "- When you use a source, cite it like [T1] or [I1].\n"
        "- Reply in the same language as the user question.\n\n"
        "Style / photo questions (e.g. \"what wedding style is this?\"):\n"
        "- If retrieved sources clearly come from a theme guide "
        "(e.g. Rustic_Wedding.pdf, Enchanted_Forest_Wedding.pdf), "
        "name that style and briefly say why it matches, using the context.\n"
        "- The PDF / section title is valid evidence for the style label.\n"
        "- Still cite [T…] / [I…].\n\n"
        "Only say you don't have enough information if context is empty "
        "or clearly unrelated to the question. "
        "Do not invent venues or facts not in the context."
    )
    user = (
        f"Question:\n{query}\n\n"
        f"Context:\n{context_block}\n\n"
        "Answer from the context. For style questions, use the matched "
        "theme guide name when sources agree.\n\n"
        "Answer:"
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


def generate_answer(
    query: str,
    contexts: list[dict[str, Any]],
    *,
    image_contexts: list[dict[str, Any]] | None = None,
    model: str = DEFAULT_LLM_MODEL,
    temperature: float = 0.2,
    max_tokens: int = 2048,
) -> str:
    client = get_llm_client()
    messages = build_rag_messages(query, contexts, image_contexts=image_contexts)
    response = client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    content = response.choices[0].message.content
    if not content:
        raise RuntimeError("LLM returned an empty answer.")
    return content.strip()


def generate_ops_answer(
    query: str,
    contexts: list[dict[str, Any]],
    *,
    topics: list[str] | None = None,
    model: str = DEFAULT_LLM_MODEL,
    temperature: float = 0.2,
    max_tokens: int = 2048,
) -> str:
    """Ops/workbook answer: synthesized bullets, not raw chunk dump."""
    messages = build_rag_messages(query, contexts)
    source_files = sorted({
        str(ctx.get("file_name") or "").strip()
        for ctx in (contexts or [])
        if str(ctx.get("file_name") or "").strip()
    })
    source_line = ", ".join(source_files) if source_files else "(unknown)"

    extra = (
        "\n\nAdditional rules for planning-pack ops answers:\n"
        "- Document text WAS provided. You MUST summarize it.\n"
        "- Never say you lack information when context chunks are present.\n"
        "- Context may have OCR noise; extract useful facts anyway.\n"
        "- Write 4 to 8 bullets: Topic: practical detail\n"
        "- Include ONLY information relevant to the user's request.\n"
        "- If the question names a country, region, or custom, exclude other ones.\n"
        "- Reply in the same language as the retrieved document text "
        "(Arabic docs → Arabic, French docs → French, English docs → English). "
        "Do not follow the user-question language for this answer.\n"
        f"- End with one line: Sources: {source_line}\n"
        "- Use those exact PDF filenames. Do not invent other source names."
    )
    messages[0]["content"] = messages[0]["content"] + extra

    client = get_llm_client()
    response = client.chat.completions.create(
        model=model,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    content = response.choices[0].message.content
    if not content:
        raise RuntimeError("LLM returned an empty answer.")
    return content.strip()


    