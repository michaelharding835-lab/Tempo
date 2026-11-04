"""Recognise HYROX sessions and break them into runs and stations.

Garmin has no HYROX profile, so athletes record races as a renamed Cardio profile with
the lap key, a custom multisport profile, or a Connect IQ app that names each lap.
We accept any of those: named laps are matched to stations, and unnamed laps are
classified by distance (runs cover ~1 km; stations barely move).
"""

from __future__ import annotations

import re
from typing import Any

STATIONS = ["SkiErg", "Sled Push", "Sled Pull", "Burpee Broad Jumps", "Row",
            "Farmers Carry", "Sandbag Lunges", "Wall Balls"]

STATION_PATTERNS = [
    (re.compile(r"ski", re.I), "SkiErg"),
    (re.compile(r"push", re.I), "Sled Push"),
    (re.compile(r"pull", re.I), "Sled Pull"),
    (re.compile(r"burpee|bbj|broad", re.I), "Burpee Broad Jumps"),
    (re.compile(r"\brow", re.I), "Row"),
    (re.compile(r"farmer|carry", re.I), "Farmers Carry"),
    (re.compile(r"lunge", re.I), "Sandbag Lunges"),
    (re.compile(r"wall|ball", re.I), "Wall Balls"),
]
RUN_RE = re.compile(r"\brun\b|running|^run\s*\d", re.I)
ROX_RE = re.compile(r"rox\s*zone|transition", re.I)


def _station_for(name: str | None) -> str | None:
    if not name:
        return None
    for pattern, station in STATION_PATTERNS:
        if pattern.search(name):
            return station
    return None


def classify(laps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for lap in laps:
        name = lap.get("name")
        dist = lap.get("distance_m") or 0
        dur = lap.get("duration_s") or 0
        if not dur:
            continue
        station = _station_for(name)
        if name and ROX_RE.search(name):
            kind = "roxzone"
        elif station:
            kind = "station"
        elif name and RUN_RE.search(name):
            kind = "run"
        elif dist >= 500:
            kind = "run"
        elif dist < 250:
            kind = "station"
        else:
            kind = "other"
        out.append({**lap, "kind": kind, "station": station})
    return out


def analyse(laps: list[dict[str, Any]], require_pattern: bool = False) -> dict[str, Any] | None:
    """Return a HYROX breakdown, or None if the laps don't look like one."""
    rows = classify(laps)
    runs = [r for r in rows if r["kind"] == "run"]
    stations = [r for r in rows if r["kind"] == "station"]
    named = sum(1 for r in stations if r["station"])
    if len(runs) < 3 or len(stations) < 3:
        return None
    if require_pattern and named < 3:
        # Without names, demand the alternating run/station rhythm.
        kinds = [r["kind"] for r in rows if r["kind"] in ("run", "station")]
        switches = sum(1 for a, b in zip(kinds, kinds[1:]) if a != b)
        if switches < max(5, len(kinds) * 0.7) or not 4 <= len(runs) <= 10:
            return None
    # Unnamed stations follow race order.
    order = iter(STATIONS)
    for r in stations:
        if not r["station"]:
            r["station"] = next(order, f"Station {stations.index(r) + 1}")
    roxzone_s = sum(r["duration_s"] for r in rows if r["kind"] == "roxzone")
    run_rows = []
    for i, r in enumerate(runs):
        pace = r["duration_s"] / r["distance_m"] * 1000 if r.get("distance_m") else None
        run_rows.append({"n": i + 1, "duration_s": round(r["duration_s"], 1), "distance_m": r.get("distance_m"),
                         "pace_s_km": round(pace, 1) if pace else None, "avg_hr": r.get("avg_hr")})
    station_rows = [{"n": i + 1, "name": r["station"], "duration_s": round(r["duration_s"], 1),
                     "avg_hr": r.get("avg_hr"), "max_hr": r.get("max_hr")} for i, r in enumerate(stations)]
    paces = [r["pace_s_km"] for r in run_rows if r["pace_s_km"]]
    compromised = None
    if len(paces) >= 3:
        first_pace = paces[0]
        later = paces[1:]
        avg_later = sum(later) / len(later)
        compromised = {
            "first_pace": round(first_pace, 1),
            "avg_pace": round(sum(paces) / len(paces), 1),
            "later_avg_pace": round(avg_later, 1),
            "decay_pct": round((avg_later - first_pace) / first_pace * 100, 1),
            "fastest": min(range(len(paces)), key=lambda i: paces[i]) + 1,
            "slowest": max(range(len(paces)), key=lambda i: paces[i]) + 1,
        }
    total = sum(r["duration_s"] for r in rows)
    run_total = sum(r["duration_s"] for r in runs)
    station_total = sum(r["duration_s"] for r in stations)
    slowest_station = max(station_rows, key=lambda r: r["duration_s"]) if station_rows else None
    return {
        "total_s": round(total, 1),
        "run_total_s": round(run_total, 1),
        "station_total_s": round(station_total, 1),
        "roxzone_s": round(roxzone_s, 1) or None,
        "runs": run_rows,
        "stations": station_rows,
        "compromised": compromised,
        "longest_station": slowest_station["name"] if slowest_station else None,
        "complete": len(runs) >= 8 and len(stations) >= 8,
        "source": "named laps" if named >= 3 else "lap pattern",
        "sequence": [{"kind": r["kind"], "label": r["station"] if r["kind"] == "station" else
                      ("Run" if r["kind"] == "run" else "Roxzone"), "duration_s": round(r["duration_s"], 1)}
                     for r in rows if r["kind"] in ("run", "station", "roxzone")],
    }
