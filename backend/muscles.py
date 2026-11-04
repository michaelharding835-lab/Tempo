"""Which muscles a strength session worked, from Garmin's exercise sets.

Garmin labels every set with a category (BENCH_PRESS, ROW, SQUAT…) and usually a
specific exercise name (INCLINE_DUMBBELL_BENCH_PRESS, FACE_PULL…). Specific names
are matched first, then the category. Each set counts 1 for its primary muscles and
0.5 for its secondary ones, so weekly totals read as "hard sets per muscle".
"""

from __future__ import annotations

import re
from typing import Any, Iterable

MUSCLES = ["chest", "frontDelts", "rearDelts", "biceps", "triceps", "forearms", "abs", "obliques",
           "lats", "upperBack", "traps", "lowerBack", "glutes", "quads", "hamstrings", "calves"]

LABELS = {"chest": "Chest", "frontDelts": "Front delts", "rearDelts": "Rear delts", "biceps": "Biceps",
          "triceps": "Triceps", "forearms": "Forearms", "abs": "Abs", "obliques": "Obliques", "lats": "Lats",
          "upperBack": "Upper back", "traps": "Traps", "lowerBack": "Lower back", "glutes": "Glutes",
          "quads": "Quads", "hamstrings": "Hamstrings", "calves": "Calves"}

P, S = "primary", "secondary"

# Specific exercises, matched as regular expressions against the Garmin name.
NAME_RULES: list[tuple[str, list[str], list[str]]] = [
    (r"ROMANIAN|STIFF_LEG|SINGLE_LEG_DEADLIFT|\bRDL", ["hamstrings", "glutes"], ["lowerBack"]),
    (r"GOOD_MORNING", ["hamstrings", "lowerBack"], ["glutes"]),
    (r"HIP_THRUST|GLUTE_BRIDGE|HIP_BRIDGE", ["glutes"], ["hamstrings"]),
    (r"NORDIC|HAMSTRING", ["hamstrings"], ["glutes"]),
    (r"LEG_EXTENSION", ["quads"], []),
    (r"LEG_PRESS|HACK_SQUAT|STEP_UP|PISTOL|WALL_SIT", ["quads", "glutes"], ["hamstrings"]),
    (r"CALF", ["calves"], []),
    (r"THRUSTER", ["quads", "glutes", "frontDelts"], ["triceps", "abs"]),
    (r"WALL_BALL", ["quads", "glutes", "frontDelts"], ["triceps", "abs"]),
    (r"BURPEE", ["chest", "quads"], ["frontDelts", "triceps", "glutes", "abs"]),
    (r"KETTLEBELL_SWING|_SWING", ["glutes", "hamstrings"], ["lowerBack", "frontDelts", "forearms"]),
    (r"FARMER|SUITCASE", ["forearms", "traps"], ["abs", "obliques", "upperBack"]),
    (r"SKI", ["lats", "triceps"], ["abs", "upperBack"]),
    (r"SLED_PUSH|PROWLER", ["quads", "glutes"], ["calves", "frontDelts"]),
    (r"SLED_PULL|SLED_DRAG", ["upperBack", "lats", "hamstrings"], ["biceps", "forearms", "glutes"]),
    (r"FACE_PULL", ["rearDelts"], ["upperBack", "traps"]),
    (r"REAR_DELT|REVERSE_FLY|REVERSE_FLYE|BENT_OVER_LATERAL|RAISE_REAR", ["rearDelts"], ["upperBack"]),
    (r"UPRIGHT_ROW", ["traps", "frontDelts"], ["biceps"]),
    (r"PULLDOWN|PULL_DOWN|CHIN_UP|PULL_UP|MUSCLE_UP", ["lats", "biceps"], ["upperBack", "forearms"]),
    (r"STRAIGHT_ARM|PULLOVER", ["lats"], ["chest", "triceps"]),
    (r"CLOSE_GRIP|DIP|SKULL|TRICEP|KICKBACK", ["triceps"], ["chest", "frontDelts"]),
    (r"INCLINE.*PRESS|INCLINE.*BENCH", ["chest", "frontDelts"], ["triceps"]),
    (r"HAMMER_CURL|REVERSE_CURL|WRIST", ["forearms", "biceps"], []),
    (r"PUSH_PRESS", ["frontDelts", "triceps"], ["quads", "glutes"]),
    (r"ARNOLD|MILITARY|OVERHEAD.*PRESS|SHOULDER_PRESS", ["frontDelts", "triceps"], ["traps", "chest"]),
    (r"RUSSIAN_TWIST|SIDE_PLANK|OBLIQUE|WOODCHOP|WINDSHIELD|PALLOF", ["obliques"], ["abs"]),
    (r"BACK_EXTENSION|SUPERMAN|REVERSE_HYPER", ["lowerBack", "glutes"], ["hamstrings"]),
    (r"SHRUG", ["traps"], ["forearms"]),
    (r"SANDBAG.*LUNGE|LUNGE|SPLIT_SQUAT", ["quads", "glutes"], ["hamstrings", "calves"]),
    (r"ROWING_MACHINE|INDOOR_ROW|ERG_ROW", ["lats", "upperBack", "quads"], ["hamstrings", "biceps"]),
]

# Garmin exercise categories.
CATEGORY_RULES: dict[str, tuple[list[str], list[str]]] = {
    "BENCH_PRESS": (["chest", "frontDelts", "triceps"], []),
    "PUSH_UP": (["chest", "triceps"], ["frontDelts", "abs"]),
    "FLYE": (["chest"], ["frontDelts"]),
    "SHOULDER_PRESS": (["frontDelts", "triceps"], ["traps"]),
    "LATERAL_RAISE": (["frontDelts"], ["traps"]),
    "TRICEPS_EXTENSION": (["triceps"], []),
    "CURL": (["biceps"], ["forearms"]),
    "PULL_UP": (["lats", "biceps"], ["upperBack", "forearms"]),
    "ROW": (["upperBack", "lats"], ["biceps", "rearDelts", "forearms"]),
    "SHRUG": (["traps"], ["forearms"]),
    "DEADLIFT": (["hamstrings", "glutes", "lowerBack"], ["upperBack", "traps", "forearms", "quads"]),
    "SQUAT": (["quads", "glutes"], ["hamstrings", "lowerBack", "abs"]),
    "LUNGE": (["quads", "glutes"], ["hamstrings", "calves"]),
    "LEG_CURL": (["hamstrings"], ["calves"]),
    "CALF_RAISE": (["calves"], []),
    "HIP_RAISE": (["glutes", "hamstrings"], []),
    "HIP_STABILITY": (["glutes"], []),
    "HIP_SWING": (["glutes", "hamstrings"], ["lowerBack", "frontDelts"]),
    "HYPEREXTENSION": (["lowerBack", "glutes"], ["hamstrings"]),
    "CRUNCH": (["abs"], ["obliques"]),
    "SIT_UP": (["abs"], ["obliques"]),
    "LEG_RAISE": (["abs"], ["obliques"]),
    "PLANK": (["abs"], ["obliques", "frontDelts"]),
    "CORE": (["abs", "obliques"], []),
    "CHOP": (["obliques"], ["abs", "frontDelts"]),
    "CARRY": (["forearms", "traps"], ["abs", "upperBack"]),
    "OLYMPIC_LIFT": (["quads", "glutes", "traps"], ["hamstrings", "frontDelts", "lowerBack"]),
    "TOTAL_BODY": (["quads", "chest"], ["frontDelts", "abs"]),
    "PLYO": (["quads", "glutes", "calves"], []),
    "SHOULDER_STABILITY": (["rearDelts"], ["upperBack"]),
    "SLED": (["quads", "glutes"], ["calves", "hamstrings"]),
    "SANDBAG": (["quads", "glutes"], ["abs", "upperBack"]),
    "BATTLE_ROPE": (["frontDelts"], ["abs", "forearms"]),
    "SUSPENSION": (["upperBack"], ["abs", "biceps"]),
    "INDOOR_ROW": (["lats", "upperBack", "quads"], ["hamstrings", "biceps"]),
}

NO_MUSCLE = {"WARM_UP", "CARDIO", "RUN", "RUN_INDOOR", "BIKE", "BIKE_OUTDOOR", "INDOOR_BIKE", "ELLIPTICAL",
             "STAIR_STEPPER", "FLOOR_CLIMB", "LADDER", "MOVE", "POSE", "CARDIO_SENSOR", "UNKNOWN", "REST"}

_COMPILED = [(re.compile(rx), p, s) for rx, p, s in NAME_RULES]

# HYROX stations, counted as set-equivalents.
STATION_LOAD: dict[str, tuple[float, list[str], list[str]]] = {
    "SkiErg": (2, ["lats", "triceps"], ["abs", "upperBack"]),
    "Sled Push": (3, ["quads", "glutes"], ["calves", "frontDelts"]),
    "Sled Pull": (3, ["upperBack", "lats", "hamstrings"], ["biceps", "forearms", "glutes"]),
    "Burpee Broad Jumps": (2, ["chest", "quads", "glutes"], ["frontDelts", "triceps", "abs"]),
    "Row": (2, ["lats", "upperBack", "quads"], ["hamstrings", "biceps"]),
    "Farmers Carry": (2, ["forearms", "traps"], ["abs", "upperBack"]),
    "Sandbag Lunges": (3, ["quads", "glutes"], ["hamstrings", "calves", "abs"]),
    "Wall Balls": (3, ["quads", "glutes", "frontDelts"], ["triceps", "abs"]),
}


def map_exercise(category: str | None, name: str | None) -> tuple[list[str], list[str]] | None:
    """Return (primary, secondary) muscles, or None if this isn't a muscle exercise."""
    cat = (category or "").upper().strip()
    nm = (name or "").upper().strip().replace(" ", "_").replace("-", "_")
    if cat in NO_MUSCLE and not nm:
        return None
    for rx, prim, sec in _COMPILED:
        if nm and rx.search(nm):
            return prim, sec
    if cat in CATEGORY_RULES:
        return CATEGORY_RULES[cat]
    if cat in NO_MUSCLE:
        return None
    for rx, prim, sec in _COMPILED:  # some categories carry the specific name
        if cat and rx.search(cat):
            return prim, sec
    return [], []


def _add(totals: dict[str, float], prim: Iterable[str], sec: Iterable[str], sets: float) -> None:
    for m in prim:
        totals[m] = totals.get(m, 0) + sets
    for m in sec:
        if m not in prim:
            totals[m] = totals.get(m, 0) + sets * 0.5


def from_exercise_sets(raw: Any) -> tuple[dict[str, float], list[str]]:
    """Muscle totals from get_activity_exercise_sets. Returns (totals, unmapped names)."""
    totals: dict[str, float] = {}
    unmapped: set[str] = set()
    for s in (raw or {}).get("exerciseSets") or []:
        if not isinstance(s, dict) or s.get("setType") != "ACTIVE":
            continue
        ex = (s.get("exercises") or [{}])
        ex = max(ex, key=lambda e: e.get("probability") or 0) if ex else {}
        mapped = map_exercise(ex.get("category"), ex.get("name"))
        if mapped is None:
            continue
        prim, sec = mapped
        if not prim and not sec:
            unmapped.add(_pretty(ex.get("name") or ex.get("category") or "Unknown exercise"))
            continue
        _add(totals, prim, sec, 1.0)
    return _round(totals), sorted(unmapped)


def from_summary(summary: Any) -> tuple[dict[str, float], list[str]]:
    """Fallback: the activity list's summarizedExerciseSets (category level)."""
    totals: dict[str, float] = {}
    unmapped: set[str] = set()
    for row in summary or []:
        if not isinstance(row, dict):
            continue
        mapped = map_exercise(row.get("category"), row.get("subCategory"))
        if mapped is None:
            continue
        prim, sec = mapped
        if not prim and not sec:
            unmapped.add(_pretty(row.get("subCategory") or row.get("category") or "Unknown exercise"))
            continue
        _add(totals, prim, sec, float(row.get("sets") or 1))
    return _round(totals), sorted(unmapped)


def from_hyrox(analysis: dict[str, Any] | None) -> dict[str, float]:
    totals: dict[str, float] = {}
    for st in (analysis or {}).get("stations") or []:
        load = STATION_LOAD.get(st.get("name"))
        if load:
            _add(totals, load[1], load[2], load[0])
    return _round(totals)


def _round(totals: dict[str, float]) -> dict[str, float]:
    return {k: round(v, 1) for k, v in totals.items() if v > 0}


def _pretty(text: str) -> str:
    t = text.replace("_", " ").strip().lower()
    return t[:1].upper() + t[1:]
