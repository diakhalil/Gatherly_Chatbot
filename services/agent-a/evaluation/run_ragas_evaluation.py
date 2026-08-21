from __future__ import annotations

import asyncio
import json
import os
import time
from pathlib import Path
from statistics import mean

from agent.services.mcp_tools import GatherlyMCPClient
from evaluation.ragas_helpers import (
    create_ragas_client,
    create_ragas_embeddings,
    create_ragas_llm,
    document_contexts,
    document_record_ids,
    load_ragas_cases,
    resolve_ground_truth,
)

ROOT = Path(__file__).resolve().parent
RESULTS = ROOT / "results" / "ragas_eval_results.json"


def _average(values: list[float | None]) -> float | None:
    numeric = [value for value in values if value is not None]
    if not numeric:
        return None
    return round(mean(numeric), 3)


async def score_case(scorers: dict, case: dict, rag_result: dict) -> dict:
    question = case["message"]
    answer = (rag_result.get("answer") or "").strip()
    contexts = document_contexts(rag_result.get("documents", []))
    reference = resolve_ground_truth(case)

    faithfulness = await scorers["faithfulness"].ascore(
        user_input=question,
        response=answer,
        retrieved_contexts=contexts,
    )
    answer_relevancy = await scorers["answer_relevancy"].ascore(
        user_input=question,
        response=answer,
    )

    context_precision = None
    context_recall = None
    if reference:
        context_precision = await scorers["context_precision"].ascore(
            user_input=question,
            reference=reference,
            retrieved_contexts=contexts,
        )
        context_recall = await scorers["context_recall"].ascore(
            user_input=question,
            reference=reference,
            retrieved_contexts=contexts,
        )

    return {
        "faithfulness": round(float(faithfulness.value), 3),
        "answer_relevancy": round(float(answer_relevancy.value), 3),
        "context_precision": (
            round(float(context_precision.value), 3)
            if context_precision is not None
            else None
        ),
        "context_recall": (
            round(float(context_recall.value), 3)
            if context_recall is not None
            else None
        ),
        "answer": answer,
        "contexts": contexts,
        "ground_truth": reference,
        "retrieved_record_ids": document_record_ids(rag_result.get("documents", [])),
    }


async def main():
    from ragas.metrics.collections import (
        AnswerRelevancy,
        ContextPrecision,
        ContextRecall,
        Faithfulness,
    )

    cases = load_ragas_cases()
    client = create_ragas_client()
    llm = create_ragas_llm(client)
    embeddings = create_ragas_embeddings()

    scorers = {
        "faithfulness": Faithfulness(llm=llm),
        "answer_relevancy": AnswerRelevancy(llm=llm, embeddings=embeddings),
        "context_precision": ContextPrecision(llm=llm),
        "context_recall": ContextRecall(llm=llm),
    }

    rag = GatherlyMCPClient()
    rows = []

    for case in cases:
        started = time.perf_counter()
        error = None
        scored = {}

        try:
            rag_result = await rag.ask(
                query=case["message"],
                role=case["role"],
                user_id=case.get("user_id"),
                top_k=5,
                method="hybrid",
                source="both",
            )
            scored = await score_case(scorers, case, rag_result)
        except Exception as exc:
            error = str(exc)

        elapsed_ms = int((time.perf_counter() - started) * 1000)
        row = {
            "id": case["id"],
            "category": case.get("category", "routing"),
            "role": case["role"],
            "question": case["message"],
            "entity_eval_id": case.get("entity_eval_id"),
            "retrieved_record_ids": scored.get("retrieved_record_ids", []),
            "faithfulness": scored.get("faithfulness"),
            "answer_relevancy": scored.get("answer_relevancy"),
            "context_precision": scored.get("context_precision"),
            "context_recall": scored.get("context_recall"),
            "latency_ms": elapsed_ms,
            "error": error,
            "answer_preview": (scored.get("answer") or "")[:300],
            "ground_truth_preview": (scored.get("ground_truth") or "")[:300],
            "context_count": len(scored.get("contexts", [])),
        }
        rows.append(row)

        if error:
            print(f"[ERROR] {case['id']}: {error}")
            continue

        print(
            f"[OK] {case['id']} "
            f"faithfulness={row['faithfulness']} "
            f"answer_relevancy={row['answer_relevancy']} "
            f"context_precision={row['context_precision']} "
            f"context_recall={row['context_recall']}"
        )

    summary = {
        "total": len(rows),
        "judge_model": os.getenv("RAGAS_JUDGE_MODEL", "google/gemini-2.5-flash-lite"),
        "metrics_avg": {
            "faithfulness": _average([row["faithfulness"] for row in rows]),
            "answer_relevancy": _average([row["answer_relevancy"] for row in rows]),
            "context_precision": _average([row["context_precision"] for row in rows]),
            "context_recall": _average([row["context_recall"] for row in rows]),
        },
        "results": rows,
    }

    RESULTS.parent.mkdir(parents=True, exist_ok=True)
    RESULTS.write_text(json.dumps(summary, indent=2), encoding="utf-8")

    print(f"\nSaved {RESULTS}")
    print("Average scores:")
    for metric, value in summary["metrics_avg"].items():
        label = "n/a" if value is None else f"{value:.3f}"
        print(f"  - {metric}: {label}")


if __name__ == "__main__":
    asyncio.run(main())
