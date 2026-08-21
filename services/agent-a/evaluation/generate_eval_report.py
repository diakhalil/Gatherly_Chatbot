from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from statistics import mean

from evaluation.ragas_helpers import resolve_ground_truth

ROOT = Path(__file__).resolve().parent
RESULTS_DIR = ROOT / "results"
AGENT_DATASET = ROOT / "datasets" / "agent_eval.json"
RAGAS_DATASET = ROOT / "datasets" / "ragas_eval.json"
AGENT_RESULTS = RESULTS_DIR / "agent_eval_results.json"
RAGAS_RESULTS = RESULTS_DIR / "ragas_eval_results.json"
OUTPUT = RESULTS_DIR / "evaluation_report.md"


def load_json(path: Path) -> dict | list | None:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def load_cases_by_id(path: Path) -> dict[str, dict]:
    data = load_json(path)
    if not isinstance(data, list):
        return {}
    return {case["id"]: case for case in data}


def pct(value: float | None) -> str:
    if value is None:
        return "—"
    return f"{value * 100:.1f}%"


def average(values: list[float | None]) -> float | None:
    numeric = [value for value in values if value is not None]
    if not numeric:
        return None
    return round(mean(numeric), 3)


def md_cell(value, max_len: int = 200) -> str:
    if value is None:
        return "—"
    if isinstance(value, bool):
        return "PASS" if value else "FAIL"
    if isinstance(value, float):
        return f"{value:.3f}"
    text = str(value).replace("|", "\\|").replace("\n", " ").strip()
    if len(text) > max_len:
        return text[: max_len - 3] + "..."
    return text


def md_table(headers: list[str], rows: list[list]) -> str:
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join(["---"] * len(headers)) + " |",
    ]
    for row in rows:
        lines.append("| " + " | ".join(md_cell(cell) for cell in row) + " |")
    return "\n".join(lines)


def agent_golden_answer(case: dict, ragas_cases: dict[str, dict]) -> str:
    eval_type = case.get("eval_type", "routing")
    case_id = case["id"]

    if case_id.startswith("rag-"):
        ragas_case = ragas_cases.get(case_id, case)
        merged = {**case, **ragas_case}
        ground_truth = resolve_ground_truth(merged)
        if ground_truth:
            return ground_truth

    if eval_type == "routing":
        return f"Route to `{case.get('expected_handled_by', 'unknown')}`"

    if eval_type == "multi_agent":
        agents = ", ".join(case.get("expected_agents", []))
        return f"Complete with agents: {agents}"

    if eval_type == "guard":
        if not case.get("message", "").strip():
            return "Block empty input (`input_safe=false`)"
        return "Block unsafe / injection input (`input_safe=false`)"

    if eval_type == "smoke":
        return "Return any non-empty helpful response"

    return "—"


def agent_expected_actual(row: dict) -> tuple[str, str]:
    eval_type = row.get("eval_type", "routing")

    if eval_type == "routing":
        return row.get("expected_handled_by", ""), row.get("actual_handled_by", "")
    if eval_type == "multi_agent":
        expected = ", ".join(row.get("expected_agents", []))
        actual = ", ".join(row.get("completed_agents", []))
        return expected, actual
    if eval_type == "guard":
        return (
            f"input_safe={row.get('expected_input_safe')}",
            f"input_safe={row.get('input_safe')}",
        )
    return "non-empty response", row.get("detail", "")


def agent_summary_section(
    data: dict,
    agent_cases: dict[str, dict],
    ragas_cases: dict[str, dict],
) -> list[str]:
    lines = [
        "## 1. Agent Evaluation — Key Results",
        "",
        f"**Overall:** {data['passed']} / {data['total']} passed ({pct(data['pass_rate'])})",
        "",
        "### By category",
        "",
    ]

    category_rows = [
        [category, stats["passed"], stats["total"], pct(stats["pass_rate"])]
        for category, stats in sorted(data["by_category"].items())
    ]
    lines.append(md_table(["Category", "Passed", "Total", "Pass rate"], category_rows))
    lines.extend(["", "### Case summary", ""])

    summary_rows = []
    for row in data["results"]:
        expected, actual = agent_expected_actual(row)
        summary_rows.append([
            row["id"],
            row.get("eval_type", "routing"),
            row.get("category", ""),
            row.get("passed"),
            expected,
            actual,
            f"{round(row.get('latency_ms', 0) / 1000, 1)}s",
        ])

    lines.append(
        md_table(
            ["ID", "Type", "Category", "Pass", "Expected", "Actual", "Latency"],
            summary_rows,
        )
    )

    failures = [row for row in data["results"] if not row.get("passed")]
    if failures:
        lines.extend(["", "**Failures:** " + ", ".join(row["id"] for row in failures), ""])

    return lines


def agent_detailed_section(
    data: dict,
    agent_cases: dict[str, dict],
    ragas_cases: dict[str, dict],
) -> list[str]:
    lines = [
        "## 2. Agent Evaluation — Detailed Results",
        "",
    ]

    detail_rows = []
    for row in data["results"]:
        case = agent_cases.get(row["id"], {})
        detail_rows.append([
            row["id"],
            case.get("message", "—"),
            agent_golden_answer(case, ragas_cases),
            row.get("response") or row.get("response_preview") or row.get("detail") or "—",
            row.get("passed"),
        ])

    lines.append(
        md_table(
            ["ID", "Question", "Golden answer", "Actual answer", "Pass"],
            detail_rows,
        )
    )
    lines.append("")
    return lines


def ragas_summary_section(data: dict) -> list[str]:
    lines = [
        "## 3. RAGAS Evaluation — Key Results",
        "",
        f"**Judge model:** {data.get('judge_model', 'unknown')}",
        f"**Cases:** {data.get('total', 0)}",
        "",
        "### Aggregate metrics (all cases)",
        "",
    ]

    metric_rows = [
        [name.replace("_", " ").title(), value]
        for name, value in data.get("metrics_avg", {}).items()
    ]
    lines.append(md_table(["Metric", "Average"], metric_rows))

    scored_rows = [
        row for row in data.get("results", [])
        if row.get("faithfulness") is not None
    ]
    if scored_rows:
        lines.extend(["", "### Aggregate metrics (scored cases only)", ""])
        scored_metrics = {
            "faithfulness": average([r.get("faithfulness") for r in scored_rows]),
            "answer_relevancy": average([r.get("answer_relevancy") for r in scored_rows]),
            "context_precision": average([r.get("context_precision") for r in scored_rows]),
            "context_recall": average([r.get("context_recall") for r in scored_rows]),
        }
        scored_table = [
            [name.replace("_", " ").title(), value]
            for name, value in scored_metrics.items()
        ]
        lines.append(md_table(["Metric", "Average"], scored_table))
        lines.append("")
        lines.append(f"_Based on {len(scored_rows)} case(s) with successful retrieval._")

    lines.extend(["", "### Case summary", ""])

    summary_rows = []
    for row in data.get("results", []):
        summary_rows.append([
            row["id"],
            row.get("role", ""),
            row.get("faithfulness"),
            row.get("answer_relevancy"),
            row.get("context_precision"),
            row.get("context_recall"),
            "ERROR" if row.get("error") else "OK",
            f"{round(row.get('latency_ms', 0) / 1000, 1)}s",
        ])

    lines.append(
        md_table(
            [
                "ID",
                "Role",
                "Faithfulness",
                "Answer rel.",
                "Ctx precision",
                "Ctx recall",
                "Status",
                "Latency",
            ],
            summary_rows,
        )
    )
    lines.append("")
    return lines


def ragas_detailed_section(data: dict) -> list[str]:
    lines = [
        "## 4. RAGAS Evaluation — Detailed Results",
        "",
    ]

    detail_rows = []
    for row in data.get("results", []):
        detail_rows.append([
            row["id"],
            row.get("question", "—"),
            row.get("ground_truth") or row.get("ground_truth_preview", "—"),
            row.get("answer") or row.get("answer_preview", "—"),
            row.get("faithfulness"),
            row.get("answer_relevancy"),
            row.get("context_precision"),
            row.get("context_recall"),
            row.get("error") or "—",
        ])

    lines.append(
        md_table(
            [
                "ID",
                "Question",
                "Golden answer",
                "Actual answer",
                "Faithfulness",
                "Answer rel.",
                "Ctx precision",
                "Ctx recall",
                "Error",
            ],
            detail_rows,
        )
    )
    lines.append("")
    return lines


def executive_summary(agent: dict | None, ragas: dict | None) -> list[str]:
    lines = ["## Executive Summary", ""]

    if agent:
        lines.append(
            f"- **Agent eval:** {agent['passed']}/{agent['total']} passed ({pct(agent['pass_rate'])})"
        )
    else:
        lines.append("- **Agent eval:** not available")

    if ragas:
        metrics = ragas.get("metrics_avg", {})
        faith = metrics.get("faithfulness")
        rel = metrics.get("answer_relevancy")
        lines.append(
            f"- **RAGAS:** faithfulness={faith if faith is not None else '—'}, "
            f"answer relevancy={rel if rel is not None else '—'}"
        )
    else:
        lines.append("- **RAGAS:** not available")

    lines.append("")
    return lines


def build_report() -> str:
    agent = load_json(AGENT_RESULTS)
    ragas = load_json(RAGAS_RESULTS)
    agent_cases = load_cases_by_id(AGENT_DATASET)
    ragas_cases = load_cases_by_id(RAGAS_DATASET)

    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines = [
        "# Gatherly Evaluation Report",
        "",
        f"_Generated: {generated_at}_",
        "",
    ]

    lines.extend(executive_summary(
        agent if isinstance(agent, dict) else None,
        ragas if isinstance(ragas, dict) else None,
    ))

    if agent and isinstance(agent, dict):
        lines.extend(agent_summary_section(agent, agent_cases, ragas_cases))
        lines.extend(agent_detailed_section(agent, agent_cases, ragas_cases))
    else:
        lines.extend([
            "## 1. Agent Evaluation — Key Results",
            "",
            f"_Missing file: `{AGENT_RESULTS}`_",
            "",
        ])

    if ragas and isinstance(ragas, dict):
        lines.extend(ragas_summary_section(ragas))
        lines.extend(ragas_detailed_section(ragas))
    else:
        lines.extend([
            "## 3. RAGAS Evaluation — Key Results",
            "",
            f"_Missing file: `{RAGAS_RESULTS}`_",
            "",
        ])

    return "\n".join(lines).strip() + "\n"


def main():
    report = build_report()
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(report, encoding="utf-8")
    print(f"Saved {OUTPUT}")


if __name__ == "__main__":
    main()