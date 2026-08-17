#!/usr/bin/env python3
"""
Read Chronicle session turn logs from data/sessions/<sessionId>/events.jsonl.

Outputs JSON to stdout (no third-party deps). Use --raw for full persisted records.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def default_sessions_root() -> Path:
    return repo_root() / "data" / "sessions"


def session_dirs(root: Path) -> list[Path]:
    if not root.is_dir():
        return []
    return [p for p in root.iterdir() if p.is_dir()]


def session_mtime(session_dir: Path) -> float:
    events = session_dir / "events.jsonl"
    if events.is_file():
        return events.stat().st_mtime
    return session_dir.stat().st_mtime


def sessions_by_recency(root: Path) -> list[Path]:
    return sorted(session_dirs(root), key=session_mtime, reverse=True)


def load_turns(events_path: Path) -> list[dict[str, Any]]:
    if not events_path.is_file():
        return []
    out: list[dict[str, Any]] = []
    with events_path.open(encoding="utf-8") as handle:
        for line_no, line in enumerate(handle, 1):
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError as exc:
                raise SystemExit(f"{events_path}:{line_no}: invalid JSON: {exc}") from exc
    return out


def normalize_usage(usage: Any) -> dict[str, int] | None:
    if not isinstance(usage, dict):
        return None
    keys = (
        "input_tokens",
        "output_tokens",
        "total_tokens",
        "prompt_tokens",
        "completion_tokens",
    )
    picked: dict[str, int] = {}
    for key in keys:
        if key in usage and isinstance(usage[key], (int, float)):
            picked[key] = int(usage[key])
    return picked or None


def add_usage(dst: dict[str, int], usage: dict[str, int] | None) -> None:
    if not usage:
        return
    for key, val in usage.items():
        dst[key] = dst.get(key, 0) + val


def summarize_llm_call(entry: dict[str, Any]) -> dict[str, Any]:
    return {
        "agent": entry.get("agent"),
        "specialistType": entry.get("specialistType"),
        "durationMs": entry.get("durationMs"),
        "startedAtMs": entry.get("startedAtMs"),
        "endedAtMs": entry.get("endedAtMs"),
        "inputItems": entry.get("inputItems"),
        "outputItems": entry.get("outputItems"),
        "toolCalls": entry.get("toolCalls"),
        "status": entry.get("status"),
        "error": entry.get("error"),
        "responseId": entry.get("responseId"),
        "previousResponseId": entry.get("previousResponseId"),
        "parentResponseId": entry.get("parentResponseId"),
        "usage": normalize_usage(entry.get("usage")),
    }


def tool_output_ok(output: Any) -> bool | None:
    if not isinstance(output, dict):
        return None
    if output.get("error") is not None:
        return False
    if output.get("ok") is False:
        return False
    return True


def summarize_tool_call(entry: dict[str, Any]) -> dict[str, Any]:
    return {
        "tool": entry.get("tool"),
        "agent": entry.get("agent"),
        "iteration": entry.get("iteration"),
        "callId": entry.get("callId"),
        "callIndex": entry.get("callIndex"),
        "callCount": entry.get("callCount"),
        "stage": entry.get("stage"),
        "executionMs": entry.get("executionMs"),
        "outputOk": tool_output_ok(entry.get("output")),
    }


def summarize_turn(rec: dict[str, Any]) -> dict[str, Any]:
    trace = rec.get("trace") or {}
    llm_calls = trace.get("llmCalls") or []
    tool_calls = trace.get("toolCalls") or []
    telemetry = rec.get("telemetry") or {}
    location = telemetry.get("location") if isinstance(telemetry, dict) else None
    loc_name = location.get("name") if isinstance(location, dict) else None
    turn_usage: dict[str, int] = {}
    for call in llm_calls:
        if isinstance(call, dict):
            add_usage(turn_usage, normalize_usage(call.get("usage")))
    return {
        "turn": rec.get("turn"),
        "atIso": rec.get("atIso"),
        "playerId": rec.get("playerId"),
        "playerText": rec.get("playerText"),
        "narrationChars": len(rec.get("narration") or ""),
        "acceptedEvents": len(rec.get("acceptedEvents") or []),
        "rejectedEvents": len(rec.get("rejectedEvents") or []),
        "locationName": loc_name,
        "hasTrace": bool(trace),
        "llmCallCount": len(llm_calls),
        "toolCallCount": len(tool_calls),
        "usageThisTurn": turn_usage,
        "llmCalls": [summarize_llm_call(c) for c in llm_calls if isinstance(c, dict)],
        "toolCalls": [summarize_tool_call(c) for c in tool_calls if isinstance(c, dict)],
    }


def rollup_session(turns: Iterable[dict[str, Any]]) -> dict[str, Any]:
    usage: dict[str, int] = {}
    llm_total = 0
    tool_total = 0
    by_agent: dict[str, int] = {}
    for rec in turns:
        trace = rec.get("trace") or {}
        llm_calls = trace.get("llmCalls") or []
        tool_calls = trace.get("toolCalls") or []
        llm_total += len(llm_calls)
        tool_total += len(tool_calls)
        for call in llm_calls:
            if not isinstance(call, dict):
                continue
            add_usage(usage, normalize_usage(call.get("usage")))
            agent = str(call.get("agent") or "unknown")
            by_agent[agent] = by_agent.get(agent, 0) + 1
    return {
        "llmCallsTotal": llm_total,
        "toolCallsTotal": tool_total,
        "llmCallsByAgent": dict(sorted(by_agent.items(), key=lambda kv: (-kv[1], kv[0]))),
        "usageTotal": usage,
    }


def dump_json(obj: Any) -> None:
    try:
        json.dump(obj, sys.stdout, indent=2, default=str)
        sys.stdout.write("\n")
    except BrokenPipeError:
        try:
            sys.stdout.close()
        except Exception:
            pass
        raise SystemExit(0) from None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Inspect Chronicle session events.jsonl as JSON.")
    parser.add_argument(
        "session_id",
        nargs="?",
        help="Session directory name under sessions root (omit with --latest)",
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=None,
        help=f"Sessions root directory (default: {default_sessions_root()})",
    )
    parser.add_argument("--latest", action="store_true", help="Pick the session with newest events.jsonl mtime")
    parser.add_argument("--list", action="store_true", help="List sessions by recency (metadata only)")
    parser.add_argument("--raw", action="store_true", help="Include full turn records (large)")
    args = parser.parse_args(argv)

    root = args.root or default_sessions_root()

    if args.list:
        rows = []
        for session_dir in sessions_by_recency(root):
            events = session_dir / "events.jsonl"
            rows.append(
                {
                    "sessionId": session_dir.name,
                    "eventsPath": str(events),
                    "hasEventsJsonl": events.is_file(),
                    "eventsBytes": events.stat().st_size if events.is_file() else 0,
                    "mtimeIso": datetime.fromtimestamp(session_mtime(session_dir), tz=timezone.utc).isoformat(),
                }
            )
        dump_json({"sessionsRoot": str(root), "sessionCount": len(rows), "sessions": rows})
        return 0

    if args.latest or not args.session_id:
        ordered = sessions_by_recency(root)
        if not ordered:
            dump_json({"error": "no_sessions", "sessionsRoot": str(root)})
            return 1
        session_dir = ordered[0]
    else:
        session_dir = root / args.session_id
        if not session_dir.is_dir():
            dump_json({"error": "session_not_found", "sessionId": args.session_id, "sessionsRoot": str(root)})
            return 1

    events_path = session_dir / "events.jsonl"
    turns = load_turns(events_path)

    if args.raw:
        dump_json(
            {
                "sessionId": session_dir.name,
                "sessionsRoot": str(root),
                "eventsPath": str(events_path),
                "turnCount": len(turns),
                "turns": turns,
            }
        )
        return 0

    summarized = [summarize_turn(t) for t in turns]
    payload = {
        "sessionId": session_dir.name,
        "sessionsRoot": str(root),
        "eventsPath": str(events_path),
        "turnCount": len(turns),
        "rollup": rollup_session(turns),
        "turns": summarized,
    }
    dump_json(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
