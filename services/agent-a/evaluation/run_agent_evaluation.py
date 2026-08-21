import asyncio
import json
import os
import re
import time
from collections import defaultdict
from pathlib import Path

from evaluation.helpers import run_eval_case

ROOT = Path(__file__).resolve().parent
DATASET = ROOT / "datasets" / "agent_eval.json"
RESULTS = ROOT / "results" / "agent_eval_results.json"
LOG_FILE = ROOT.parents[2] / "logs" / "gatherly.log"
RESET_CACHE = os.getenv("RESET_CACHE", "").strip() in {"1", "true", "True", "yes"}
TOOL_CALL_PATTERN = re.compile(r"AGENT TOOL.*?\| call \| ([A-Za-z0-9_]+) \|")
INTERNAL_TOOLS = {"run_sql"}


def log_position() -> int:
    return LOG_FILE.stat().st_size if LOG_FILE.exists() else 0


def tool_calls_since(position: int) -> list[str]:
    if not LOG_FILE.exists():
        return []
    with LOG_FILE.open("rb") as handle:
        handle.seek(position)
        text = handle.read().decode("utf-8", errors="replace")
    calls = TOOL_CALL_PATTERN.findall(text)
    return list(dict.fromkeys(name for name in calls if name not in INTERNAL_TOOLS))


def score_case(case: dict, state: dict, error: str | None) -> tuple[bool, str]:
    eval_type = case.get("eval_type", "routing")

    if error:
        return False, f"error: {error}"

    if eval_type == "guard":
        expected_safe = case.get("expected_input_safe", False)
        actual_safe = state.get("input_safe")
        passed = actual_safe is expected_safe
        return passed, f"input_safe={actual_safe}"

    if eval_type == "multi_agent":
        completed = set(state.get("completed_agents", []))
        expected = set(case.get("expected_agents", []))
        passed = expected.issubset(completed)
        return passed, f"completed={sorted(completed)} expected={sorted(expected)}"

    if eval_type == "smoke":
        response = (state.get("response") or "").strip()
        passed = bool(response)
        return passed, f"response_length={len(response)}"

    expected = case.get("expected_handled_by", "")
    actual = state.get("selected_agent", "")
    passed = actual == expected
    return passed, f"expected={expected} actual={actual}"


def row_is_complete(row: dict) -> bool:
    return (
        bool(row.get("id"))
        and not row.get("error")
        and "tool_selection_correct" in row
    )


def load_cached_rows() -> dict[str, dict]:
    if RESET_CACHE and RESULTS.exists():
        RESULTS.unlink()
        return {}
    if not RESULTS.exists():
        return {}
    payload = json.loads(RESULTS.read_text(encoding="utf-8"))
    rows = payload.get("results") if isinstance(payload, dict) else payload
    if not isinstance(rows, list):
        return {}
    return {
        row["id"]: row
        for row in rows
        if isinstance(row, dict) and row_is_complete(row)
    }


def build_summary(rows: list[dict]) -> dict:
    category_stats = defaultdict(lambda: {"passed": 0, "total": 0})
    for row in rows:
        category_stats[row["category"]]["total"] += 1
        if row.get("passed"):
            category_stats[row["category"]]["passed"] += 1
    passed_count = sum(1 for row in rows if row.get("passed"))
    routing_rows = [row for row in rows if row.get("eval_type") == "routing"]
    routing_correct = sum(1 for row in routing_rows if row.get("passed"))
    tool_rows = [
        row for row in rows if row.get("tool_selection_correct") is not None
    ]
    tool_correct = sum(
        1 for row in tool_rows if row.get("tool_selection_correct") is True
    )
    return {
        "total": len(rows),
        "passed": passed_count,
        "pass_rate": round(passed_count / len(rows), 3) if rows else 0,
        "routing": {
            "correct": routing_correct,
            "total": len(routing_rows),
            "accuracy": round(routing_correct / len(routing_rows), 3)
            if routing_rows
            else None,
        },
        "tool_selection": {
            "correct": tool_correct,
            "total": len(tool_rows),
            "accuracy": round(tool_correct / len(tool_rows), 3) if tool_rows else None,
        },
        "by_category": {
            category: {
                "passed": stats["passed"],
                "total": stats["total"],
                "pass_rate": round(stats["passed"] / stats["total"], 3)
                if stats["total"]
                else 0,
            }
            for category, stats in sorted(category_stats.items())
        },
        "results": rows,
    }


def save_results(rows: list[dict]) -> dict:
    summary = build_summary(rows)
    RESULTS.parent.mkdir(parents=True, exist_ok=True)
    RESULTS.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return summary


async def main():
    cases = json.loads(DATASET.read_text(encoding="utf-8"))
    cached = load_cached_rows()
    by_id = dict(cached)
    print(f"Resuming with {len(by_id)}/{len(cases)} cached complete results")
    print(f"RESET_CACHE={RESET_CACHE}")

    for case in cases:
        case_id = case["id"]
        if case_id in by_id:
            print(f"[SKIP] {case_id} ({case.get('eval_type', 'routing')}) cached")
            continue

        started = time.perf_counter()
        case_log_position = log_position()
        error = None
        state = {}
        try:
            state = await run_eval_case(case)
        except Exception as exc:
            error = str(exc)

        elapsed_ms = int((time.perf_counter() - started) * 1000)
        passed, detail = score_case(case, state, error)
        expected_agent_tools = case.get("expected_agent_tools") or []
        actual_agent_tools = tool_calls_since(case_log_position)
        tool_selection_correct = (
            set(actual_agent_tools) == set(expected_agent_tools)
            if expected_agent_tools
            else None
        )
        row = {
            "id": case_id,
            "category": case["category"],
            "eval_type": case.get("eval_type", "routing"),
            "expected_handled_by": case.get("expected_handled_by", ""),
            "expected_agents": case.get("expected_agents", []),
            "expected_input_safe": case.get("expected_input_safe"),
            "actual_handled_by": state.get("selected_agent", ""),
            "completed_agents": state.get("completed_agents", []),
            "input_safe": state.get("input_safe"),
            "passed": passed,
            "expected_scope": case.get("expected_scope"),
            "expected_agent_tools": expected_agent_tools,
            "actual_agent_tools": actual_agent_tools,
            "tool_selection_correct": tool_selection_correct,
            "latency_ms": elapsed_ms,
            "error": error,
            "detail": detail,
            "response_preview": (state.get("response") or "")[:200],
        }
        by_id[case_id] = row

        ordered = []
        seen = set()
        for item in cases:
            if item["id"] in by_id and item["id"] not in seen:
                ordered.append(by_id[item["id"]])
                seen.add(item["id"])
        save_results(ordered)

        status = "PASS" if passed else "FAIL"
        print(f"[{status}] {case_id} ({case.get('eval_type', 'routing')}) {detail}")

    ordered = [by_id[case["id"]] for case in cases if case["id"] in by_id]
    summary = save_results(ordered)
    print(f"\nSaved {RESULTS}")
    print(f"Overall: {summary['passed']}/{summary['total']}")
    routing_stats = summary["routing"]
    print(
        f"Routing: {routing_stats['correct']}/{routing_stats['total']} "
        f"({routing_stats['accuracy'] * 100:.1f}%)"
    )
    tool_stats = summary["tool_selection"]
    if tool_stats["total"]:
        print(
            f"Tool selection: {tool_stats['correct']}/{tool_stats['total']} "
            f"({tool_stats['accuracy'] * 100:.1f}%)"
        )
    for category, stats in summary["by_category"].items():
        print(
            f"  - {category}: {stats['passed']}/{stats['total']} "
            f"({stats['pass_rate'] * 100:.1f}%)"
        )


if __name__ == "__main__":
    asyncio.run(main())
