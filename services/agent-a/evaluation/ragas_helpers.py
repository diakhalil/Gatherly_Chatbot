from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from openai import AsyncOpenAI

load_dotenv()

ROOT = Path(__file__).resolve().parent
AGENT_ROOT = ROOT.parent
RAG_DATASET = Path(
    os.getenv(
        "RAG_DATASET_PATH",
        AGENT_ROOT.parent / "Project" / "rag" / "rag-dataset",
    )
).resolve()
RAG_CODE = Path(
    os.getenv(
        "RAG_PROJECT_PATH",
        AGENT_ROOT.parent / "Project" / "rag" / "rag-code",
    )
).resolve()

ENTITY_RETRIEVAL = RAG_DATASET / "evaluation" / "entity-retrieval.json"
ENTITY_GENERATION = RAG_DATASET / "evaluation" / "entity-generation-hybrid-results.json"
RAGAS_DATASET = ROOT / "datasets" / "ragas_eval.json"
AGENT_DATASET = ROOT / "datasets" / "agent_eval.json"


def create_ragas_client() -> AsyncOpenAI:
    api_key = os.getenv("OPENROUTER_API_KEY")
    if not api_key:
        raise RuntimeError("OPENROUTER_API_KEY is not configured")

    return AsyncOpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key=api_key,
    )


def create_ragas_llm(client: AsyncOpenAI):
    from ragas.llms import llm_factory

    model = os.getenv("RAGAS_JUDGE_MODEL", "google/gemini-2.5-flash-lite")
    return llm_factory(model, client=client)


def create_ragas_embeddings():
    from ragas.embeddings import HuggingFaceEmbeddings

    model = os.getenv(
        "RAGAS_EMBEDDING_MODEL",
        "sentence-transformers/all-MiniLM-L6-v2",
    )
    return HuggingFaceEmbeddings(model=model)


def load_ragas_cases() -> list[dict]:
    if RAGAS_DATASET.exists():
        return json.loads(RAGAS_DATASET.read_text(encoding="utf-8"))

    cases = json.loads(AGENT_DATASET.read_text(encoding="utf-8"))
    return [
        case
        for case in cases
        if case.get("expected_handled_by") == "sql_agent"
    ]


def _entity_records_by_id() -> dict[str, dict]:
    if str(RAG_CODE) not in sys.path:
        sys.path.insert(0, str(RAG_CODE))

    from src.entity_indexer import build_entity_records

    records = build_entity_records(RAG_DATASET)
    return {record["record_id"]: record for record in records}


def _generation_answers() -> dict[str, str]:
    if not ENTITY_GENERATION.exists():
        return {}

    payload = json.loads(ENTITY_GENERATION.read_text(encoding="utf-8"))
    return {
        row["id"]: row["answer"]
        for row in payload.get("results", [])
        if row.get("answer")
    }


def _retrieval_entry(question: str, role: str) -> dict | None:
    if not ENTITY_RETRIEVAL.exists():
        return None

    entries = json.loads(ENTITY_RETRIEVAL.read_text(encoding="utf-8"))
    for entry in entries:
        if entry["question"] == question and entry["role"] == role:
            return entry
    return None


def _reference_from_records(record_ids: list[str], records_by_id: dict[str, dict]) -> str:
    if not record_ids:
        return ""

    if len(record_ids) == 1:
        record = records_by_id.get(record_ids[0])
        return record["text"] if record else ""

    preview_ids = record_ids[:5]
    snippets = []
    for record_id in preview_ids:
        record = records_by_id.get(record_id)
        if record:
            snippets.append(record["text"])

    if not snippets:
        return ""

    joined = " | ".join(snippets)
    if len(record_ids) > len(preview_ids):
        return (
            f"The answer should identify matching Gatherly records such as "
            f"{', '.join(preview_ids)} and related entries. Evidence: {joined}"
        )
    return joined


def resolve_ground_truth(case: dict) -> str:
    if case.get("ground_truth"):
        return case["ground_truth"]

    generation_answers = _generation_answers()
    entity_eval_id = case.get("entity_eval_id")
    if entity_eval_id and entity_eval_id in generation_answers:
        answer = generation_answers[entity_eval_id]
        return _strip_citations(answer)

    retrieval_entry = _retrieval_entry(case["message"], case["role"])
    records_by_id = _entity_records_by_id()

    if retrieval_entry:
        reference = _reference_from_records(
            retrieval_entry.get("relevant_record_ids", []),
            records_by_id,
        )
        if reference:
            return reference

    if case["id"] == "rag-010":
        return (
            "Host user 1 does not have an accepted event application for event 1. "
            "If no authorized record exists for this host and event, the answer should "
            "state that clearly instead of inventing an application."
        )

    return ""


def _strip_citations(text: str) -> str:
    cleaned = text.replace("[1]", "").replace("[2]", "").replace("[3]", "")
    cleaned = cleaned.replace("[4]", "").replace("[5]", "")
    return " ".join(cleaned.split())


def document_contexts(documents: list[dict]) -> list[str]:
    contexts = []
    for document in documents:
        text = (document.get("text") or "").strip()
        if text:
            contexts.append(text)
    return contexts


def document_record_ids(documents: list[dict]) -> list[str]:
    return [
        document["record_id"]
        for document in documents
        if document.get("record_id")
    ]
