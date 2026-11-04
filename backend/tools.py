"""Read-only Garmin tools, defined once and exposed two ways:

* through the MCP server at /mcp (used by the coach via Claude's MCP connector, and by
  Claude Code or any other MCP client), and
* as plain Claude API tools for the coach's local fallback loop.

Outputs drop minute-by-minute timelines and keep the numbers a coach reasons with.
"""

from __future__ import annotations

import json
from typing import Any, Callable

from . import service

HEAVY_KEYS = {"timeline", "stages", "readings", "hourly", "route", "route_preview", "sequence", "events"}


def _slim(obj: Any, depth: int = 0) -> Any:
    if isinstance(obj, dict):
        return {k: _slim(v, depth + 1) for k, v in obj.items()
                if k not in HEAVY_KEYS and v not in (None, [], {}) and not k.startswith("_")}
    if isinstance(obj, list):
        return [_slim(v, depth + 1) for v in obj]
    if isinstance(obj, float):
        return round(obj, 2)
    return obj


def _dump(obj: Any) -> str:
    return json.dumps(_slim(obj), separators=(",", ":"), default=str)


def _summarise_streams(streams: dict[str, Any], buckets: int = 12) -> dict[str, Any]:
    t = streams.get("t") or []
    if not t:
        return {}
    out = {}
    size = max(1, len(t) // buckets)
    for key, vals in streams.items():
        if key in ("t", "distance") or not vals:
            continue
        rows = []
        for i in range(0, len(vals), size):
            chunk = [v for v in vals[i:i + size] if isinstance(v, (int, float))]
            if chunk:
                rows.append(round(sum(chunk) / len(chunk), 1))
        out[key] = rows
    out["bucket_minutes"] = round((t[-1] / max(1, len(range(0, len(t), size)))) / 60, 1)
    return out


# ---------------------------------------------------------------- tool functions


def get_daily_summary(date: str | None = None) -> str:
    """Everything about one day: training readiness, sleep, HRV, Body Battery, stress,
    resting heart rate, steps, calories, intensity minutes, respiration, SpO2, hydration,
    training status, the latest activity, any recent HYROX session and the next planned
    workout. `date` is YYYY-MM-DD and defaults to today."""
    data = service.today(date)
    data = {k: v for k, v in data.items() if k not in ("recent_activities",)}
    return _dump(data)


def list_activities(limit: int = 15, sport: str | None = None) -> str:
    """Recent activities, newest first, with distance, time, pace, heart rate, training
    effect and load. `sport` filters by group: run, ride, swim, strength, cardio, walk,
    hyrox, multi. `limit` is 1-50."""
    data = service.activities(0, max(1, min(50, limit)) if not sport else 60, group=sport)
    return _dump(data["items"][:limit])


def get_activity(activity_id: int, include_streams: bool = False) -> str:
    """One activity in depth: laps/splits, heart-rate zones, weather, strength sets and a
    full HYROX breakdown (runs, stations, compromised-running decay) when it is one.
    Set include_streams to get heart rate, pace, cadence and power averaged into ~12
    time buckets."""
    data = dict(service.activity(activity_id))
    streams = data.pop("streams", {}) or {}
    if include_streams:
        data["stream_buckets"] = _summarise_streams(streams)
    return _dump(data)


def get_training_status(date: str | None = None) -> str:
    """Performance picture: training status, acute vs chronic load, load focus (low/high
    aerobic, anaerobic vs targets), VO2 max and its history, race predictions, endurance
    and hill score, lactate threshold, fitness age, HRV, weekly volume for 12 weeks and
    personal records."""
    return _dump(service.training(date))


def get_trend(metric: str, days: int = 28) -> str:
    """Daily values over time for one metric. Metrics: sleep_score, sleep_hours, hrv, rhr,
    stress, body_battery, steps, intensity, readiness, vo2max, weight, respiration,
    calories, training_load, run_distance. `days` is 7-366."""
    try:
        return _dump(service.trends(metric, days))
    except KeyError:
        return json.dumps({"error": f"Unknown metric '{metric}'."})


def get_hyrox_history() -> str:
    """Every HYROX race or simulation in the last year with run splits, station times,
    compromised-running decay, and best time per station."""
    data = service.hyrox_history()
    return _dump(data)


def get_muscle_load(date: str | None = None) -> str:
    """Hard sets per muscle group this week (Monday to `date`), from strength sessions'
    exercise sets and HYROX stations, plus muscles not trained yet this week. Use it to
    suggest what to train next."""
    data = service.muscles_week(date)
    strength: dict[str, float] = {}
    hyrox: dict[str, float] = {}
    sessions = []
    for d in data["days"]:
        for s in d["sessions"]:
            bucket = strength if s["kind"] == "strength" else hyrox
            for k, v in s["muscles"].items():
                bucket[k] = round(bucket.get(k, 0) + v, 1)
            sessions.append({"date": d["date"], "name": s["name"], "kind": s["kind"], "activity_id": s["id"]})
    untouched = [data["labels"][m] for m in data["muscles"] if not strength.get(m) and not hyrox.get(m)]
    return json.dumps({"week": f"{data['week_start']} to {data['week_end']}", "sets_from_strength": strength,
                       "set_equivalents_from_hyrox": hyrox, "not_trained_yet": untouched, "sessions": sessions,
                       "unrecognised_exercises": data["unmapped"]}, separators=(",", ":"))


def get_profile() -> str:
    """Athlete profile: name, devices, personal records, recent badges, gear mileage and
    lifetime totals."""
    data = service.profile()
    data = {**data, "badges": data.get("badges", [])[:10]}
    return _dump(data)


TOOLS: list[Callable[..., str]] = [
    get_daily_summary, list_activities, get_activity, get_training_status,
    get_trend, get_hyrox_history, get_muscle_load, get_profile,
]

# JSON schemas for the coach's local fallback loop.
SCHEMAS: dict[str, dict[str, Any]] = {
    "get_daily_summary": {"type": "object", "properties": {"date": {"type": "string", "description": "YYYY-MM-DD"}}},
    "list_activities": {"type": "object", "properties": {"limit": {"type": "integer"}, "sport": {"type": "string"}}},
    "get_activity": {"type": "object", "properties": {"activity_id": {"type": "integer"}, "include_streams": {"type": "boolean"}},
                     "required": ["activity_id"]},
    "get_training_status": {"type": "object", "properties": {"date": {"type": "string"}}},
    "get_trend": {"type": "object", "properties": {"metric": {"type": "string"}, "days": {"type": "integer"}},
                  "required": ["metric"]},
    "get_hyrox_history": {"type": "object", "properties": {}},
    "get_muscle_load": {"type": "object", "properties": {"date": {"type": "string", "description": "YYYY-MM-DD"}}},
    "get_profile": {"type": "object", "properties": {}},
}

BY_NAME = {fn.__name__: fn for fn in TOOLS}


def claude_tool_defs() -> list[dict[str, Any]]:
    return [{"name": fn.__name__, "description": (fn.__doc__ or "").strip().replace("\n", " "),
             "input_schema": SCHEMAS[fn.__name__]} for fn in TOOLS]


def run_tool(name: str, args: dict[str, Any]) -> str:
    fn = BY_NAME.get(name)
    if not fn:
        return json.dumps({"error": f"Unknown tool {name}"})
    try:
        return fn(**(args or {}))
    except Exception as exc:  # noqa: BLE001
        return json.dumps({"error": str(exc)[:300]})
