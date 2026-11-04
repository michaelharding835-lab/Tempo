"""Screen-sized bundles of Garmin data, shared by the REST API and the MCP tools."""

from __future__ import annotations

import math
from datetime import date, datetime, timedelta
from typing import Any

from . import hyrox as hx
from . import muscles as mx
from . import normalize as n
from .garmin import cached, call, gather, get_client

# Cache lifetimes (seconds)
TTL_TODAY = 60
TTL_PAST_DAY = 6 * 3600
TTL_ACTIVITY = 30 * 86400
TTL_LIST = 60
TTL_TRAINING = 600
TTL_TRENDS = 1800
TTL_PROFILE = 6 * 3600


def _iso(d: date) -> str:
    return d.isoformat()


def local_today() -> date:
    """Today's date in the athlete's own time zone (servers run on UTC)."""
    try:
        from zoneinfo import ZoneInfo

        tz = profile_basic().get("timezone")
        if tz:
            return datetime.now(ZoneInfo(tz)).date()
    except Exception:  # noqa: BLE001
        pass
    return date.today()


def _parse_date(value: str | None) -> date:
    if value:
        return date.fromisoformat(value[:10])
    return local_today()


def _ttl_for(day: date) -> int:
    return TTL_TODAY if day >= local_today() - timedelta(days=1) else TTL_PAST_DAY


# ---------------------------------------------------------------- profile


def profile_basic() -> dict[str, Any]:
    def load() -> dict[str, Any]:
        client = get_client()
        out: dict[str, Any] = {"name": None, "units": "metric", "timezone": None}
        for key, method in (("name", "get_full_name"), ("units", "get_unit_system"), ("timezone", "get_user_timezone")):
            try:
                value = getattr(client, method)()
                if value:
                    out[key] = value
            except Exception:  # noqa: BLE001
                pass
        return out

    return cached("profile_basic", TTL_PROFILE, load)


# ---------------------------------------------------------------- hyrox helpers


def _laps_for_hyrox(summary: dict[str, Any]) -> list[dict[str, Any]]:
    """Laps for an activity; a multisport activity's legs count as laps."""
    child_ids = summary.get("child_ids") or []
    if child_ids:
        results, _ = gather({str(cid): ("get_activity", cid) for cid in child_ids[:24]})
        laps = []
        for i, cid in enumerate(child_ids[:24]):
            raw = results.get(str(cid))
            if not raw:
                continue
            h = n.activity_header(raw)
            laps.append({"index": i + 1, "name": h["name"] if h["group"] != "run" else "Run",
                         "duration_s": h["duration_s"], "distance_m": h["distance_m"] or 0,
                         "avg_hr": h["avg_hr"], "max_hr": h["max_hr"]})
        return laps
    return n.laps(call("get_activity_splits", summary["id"]))


def hyrox_for(summary: dict[str, Any]) -> dict[str, Any] | None:
    """Cached HYROX analysis for one activity summary (None if it isn't one)."""
    if not summary.get("possible_hyrox"):
        return None

    def load() -> dict[str, Any]:
        try:
            laps = _laps_for_hyrox(summary)
        except Exception:  # noqa: BLE001
            return {"result": None}
        return {"result": hx.analyse(laps, require_pattern=not summary.get("is_hyrox"))}

    return cached(f"hyrox:{summary['id']}", TTL_ACTIVITY, load)["result"]


def _mark_hyrox(summary: dict[str, Any], analysis: dict[str, Any] | None) -> dict[str, Any]:
    if analysis:
        summary = {**summary, "is_hyrox": True, "group": "hyrox", "type_label": "HYROX", "hyrox": analysis}
    return summary


# ---------------------------------------------------------------- today


def today(day_str: str | None = None, fresh: bool = False) -> dict[str, Any]:
    day = _parse_date(day_str)
    d = _iso(day)

    def load() -> dict[str, Any]:
        week_start = _iso(day - timedelta(days=6))
        results, errors = gather({
            "summary": ("get_user_summary", d),
            "hr": ("get_heart_rates", d),
            "stress": ("get_stress_data", d),
            "sleep": ("get_sleep_data", d),
            "hrv": ("get_hrv_data", d),
            "readiness": ("get_training_readiness", d),
            "status": ("get_training_status", d),
            "bb_events": ("get_body_battery_events", d),
            "respiration": ("get_respiration_data", d),
            "spo2": ("get_spo2_data", d),
            "hydration": ("get_hydration_data", d),
            "weight": ("get_body_composition", _iso(day - timedelta(days=60)), d),
            "activities": ("get_activities_by_date", _iso(day - timedelta(days=13)), d),
            "steps_week": ("get_daily_steps", week_start, d),
            "sleep_week": ("get_sleep_daily", week_start, d),
            "hrv_week": ("get_hrv_data_range", week_start, d),
            "rhr_week": ("get_rhr_daily", week_start, d),
            "next_workout": ("get_next_scheduled_workout",),
        })
        summary = results["summary"] or {}
        acts = [n.activity_summary(a) for a in results["activities"] or []]
        acts.sort(key=lambda a: a["start_ms"] or 0, reverse=True)
        # Smart HYROX: confirm recent candidates with their laps.
        checked = 0
        for i, a in enumerate(acts):
            if a["possible_hyrox"] and checked < 3:
                checked += 1
                acts[i] = _mark_hyrox(a, hyrox_for(a))
        latest = acts[0] if acts else None
        if latest and latest["has_map"]:
            latest = {**latest, "route_preview": _route_preview(latest["id"])}
        hyrox_recent = next((a for a in acts if a["is_hyrox"] and a["start_local"]
                             and (day - date.fromisoformat(a["start_local"][:10])).days <= 7), None)
        weights = n.weight_entries(results["weight"])
        week = _week_strip(day, results, acts)
        return {
            "date": d,
            "profile": profile_basic(),
            "totals": n.daily_totals(summary),
            "readiness": n.readiness(results["readiness"]),
            "sleep": n.sleep(results["sleep"]),
            "hrv": n.hrv(results["hrv"]),
            "body_battery": n.body_battery(summary, results["stress"], results["bb_events"]),
            "stress": n.stress(summary, results["stress"]),
            "heart_rate": n.heart_rate(summary, results["hr"]),
            "respiration": n.respiration(summary, results["respiration"]),
            "spo2": n.spo2(summary, results["spo2"]),
            "hydration": n.hydration(results["hydration"]),
            "weight": weights[-1] if weights else None,
            "training": n.training_status(results["status"]),
            "latest_activity": latest,
            "hyrox_recent": hyrox_recent,
            "recent_activities": acts[:8],
            "next_workout": n.next_workout(results["next_workout"]),
            "week": week,
            "missing": sorted(errors),
            "synced_at": int(datetime.now().timestamp() * 1000),
        }

    return cached(f"today:{d}", _ttl_for(day), load, fresh=fresh)


def _route_preview(activity_id: Any) -> list[list[float]] | None:
    try:
        detail = activity(activity_id)
    except Exception:  # noqa: BLE001
        return None
    return n.preview_route(detail.get("route"), 90)


def _week_strip(day: date, results: dict[str, Any], acts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    steps = {r["date"]: r["value"] for r in n.range_series(results["steps_week"], ["totalSteps"])}
    sleep = {r["date"]: r["value"] for r in n.range_series(results["sleep_week"], ["sleepScore", "overallSleepScore", "sleepScores.overall.value"])}
    sleep_h = {r["date"]: r["value"] for r in n.range_series(results["sleep_week"], ["totalSleepTimeInSeconds", "sleepTimeSeconds"], 1 / 3600)}
    hrv = {r["date"]: r["value"] for r in n.range_series(results["hrv_week"], ["lastNightAvg"])}
    rhr = {r["date"]: r["value"] for r in n.range_series(results["rhr_week"], ["value", "restingHeartRate"])}
    out = []
    for i in range(6, -1, -1):
        d = _iso(day - timedelta(days=i))
        day_acts = [a for a in acts if (a["start_local"] or "").startswith(d)]
        out.append({
            "date": d, "steps": steps.get(d), "sleep_score": sleep.get(d), "sleep_h": sleep_h.get(d),
            "hrv": hrv.get(d), "rhr": rhr.get(d),
            "load": sum(a["training_load"] or 0 for a in day_acts) or 0,
            "activities": [{"id": a["id"], "group": a["group"], "name": a["name"]} for a in day_acts],
        })
    return out


# ---------------------------------------------------------------- activities


def activities(start: int = 0, limit: int = 30, group: str | None = None, fresh: bool = False) -> dict[str, Any]:
    limit = max(1, min(100, limit))

    def load() -> dict[str, Any]:
        raw = call("get_activities", start, limit) or []
        items = [n.activity_summary(a) for a in raw]
        return {"items": items, "start": start, "limit": limit, "has_more": len(raw) == limit}

    data = cached(f"activities:{start}:{limit}", TTL_LIST, load, fresh=fresh)
    items = data["items"]
    # Confirm unnamed HYROX candidates lazily (results are cached per activity).
    items = [_mark_hyrox(a, hyrox_for(a)) if a["possible_hyrox"] and not a["is_hyrox"] and i < 15 else
             (_mark_hyrox(a, hyrox_for(a)) if a["is_hyrox"] else a) for i, a in enumerate(items)]
    if group:
        items = [a for a in items if a["group"] == group]
    return {**data, "items": items}


def activity(activity_id: Any) -> dict[str, Any]:
    aid = int(activity_id)

    def load() -> dict[str, Any]:
        results, errors = gather({
            "header": ("get_activity", aid),
            "details": ("get_activity_details", aid, 2000, 2000),
            "splits": ("get_activity_splits", aid),
            "zones": ("get_activity_hr_in_timezones", aid),
            "weather": ("get_activity_weather", aid),
        })
        if not results["header"]:
            raise LookupError(f"Activity {aid} not found")
        head = n.activity_header(results["header"])
        streams = n.activity_streams(results["details"])
        route = n.activity_route(results["details"])
        laps = n.laps(results["splits"])
        sets = None
        session_muscles = None
        if head["group"] in ("strength", "cardio"):
            try:
                raw_sets = call("get_activity_exercise_sets", aid)
                sets = n.exercise_sets(raw_sets)
                session_muscles = mx.from_exercise_sets(raw_sets)[0] or None
            except Exception:  # noqa: BLE001
                sets = None
        analysis = None
        if head["possible_hyrox"] or head["is_hyrox"]:
            lap_source = laps
            if head.get("child_ids"):
                lap_source = _laps_for_hyrox(head)
            analysis = hx.analyse(lap_source, require_pattern=not head["is_hyrox"])
        if analysis:
            head = _mark_hyrox(head, analysis)
            session_muscles = mx.from_hyrox(analysis) or session_muscles
        return {
            **head,
            "route": route,
            "streams": streams,
            "laps": laps,
            "hr_zones": n.hr_zones(results["zones"]),
            "weather": n.weather(results["weather"]),
            "sets": sets,
            "muscles": session_muscles,
            "hyrox": analysis,
            "missing": sorted(errors),
        }

    return cached(f"activity:{aid}", TTL_ACTIVITY, load)


def calendar(year: int, month: int) -> dict[str, Any]:
    first_day = date(year, month, 1)
    last_day = (first_day + timedelta(days=32)).replace(day=1) - timedelta(days=1)

    def load() -> dict[str, Any]:
        raw = call("get_activities_by_date", _iso(first_day), _iso(last_day)) or []
        items = [n.activity_summary(a) for a in raw]
        days: dict[str, list[dict[str, Any]]] = {}
        for a in items:
            if a["start_local"]:
                days.setdefault(a["start_local"][:10], []).append(
                    {"id": a["id"], "name": a["name"], "group": a["group"], "duration_s": a["duration_s"],
                     "distance_m": a["distance_m"], "load": a["training_load"]})
        return {"year": year, "month": month, "days": days,
                "totals": {"activities": len(items),
                           "distance_m": round(sum(a["distance_m"] or 0 for a in items)),
                           "duration_s": round(sum(a["duration_s"] or 0 for a in items)),
                           "load": round(sum(a["training_load"] or 0 for a in items))}}

    ttl = TTL_LIST if last_day >= local_today() - timedelta(days=1) else TTL_PAST_DAY
    return cached(f"calendar:{year}-{month:02d}", ttl, load)


def hyrox_history(fresh: bool = False) -> dict[str, Any]:
    def load() -> dict[str, Any]:
        end = local_today()
        raw = call("get_activities_by_date", _iso(end - timedelta(days=365)), _iso(end)) or []
        items = [n.activity_summary(a) for a in raw]
        candidates = [a for a in items if a["is_hyrox"]]
        candidates += [a for a in items if a["possible_hyrox"] and not a["is_hyrox"]][:12]
        sessions = []
        for a in candidates[:24]:
            analysis = hyrox_for(a)
            if analysis:
                sessions.append(_mark_hyrox(a, analysis))
        sessions.sort(key=lambda a: a["start_ms"] or 0, reverse=True)
        best: dict[str, float] = {}
        for s in sessions:
            for st in s["hyrox"]["stations"]:
                if st["name"] not in best or st["duration_s"] < best[st["name"]]:
                    best[st["name"]] = st["duration_s"]
        full = [s for s in sessions if s["hyrox"]["complete"]]
        return {"sessions": sessions, "station_bests": best,
                "best_total_s": min((s["hyrox"]["total_s"] for s in full), default=None)}

    return cached("hyrox_history", TTL_TRAINING, load, fresh=fresh)


# ---------------------------------------------------------------- muscles


def _session_muscles(a: dict[str, Any], raw_item: dict[str, Any]) -> tuple[dict[str, float], list[str]]:
    """Muscle totals for one strength/HIIT session, cached per activity."""
    def load() -> dict[str, Any]:
        try:
            totals, unmapped = mx.from_exercise_sets(call("get_activity_exercise_sets", a["id"]))
        except Exception:  # noqa: BLE001
            totals, unmapped = {}, []
        if not totals:
            totals, unmapped = mx.from_summary(raw_item.get("summarizedExerciseSets"))
        return {"totals": totals, "unmapped": unmapped}

    hit = cached(f"muscles:{a['id']}", TTL_ACTIVITY, load)
    return hit["totals"], hit["unmapped"]


def muscles_week(day_str: str | None = None, fresh: bool = False) -> dict[str, Any]:
    """Muscles worked from Monday to `day`: strength sessions plus HYROX stations."""
    day = _parse_date(day_str)
    start = day - timedelta(days=day.weekday())
    end = start + timedelta(days=6)

    def load() -> dict[str, Any]:
        raw = call("get_activities_by_date", _iso(start), _iso(day)) or []
        days = {_iso(start + timedelta(days=i)): [] for i in range(7)}
        unmapped: set[str] = set()
        for item in raw:
            a = n.activity_summary(item)
            d = (a["start_local"] or "")[:10]
            if d not in days:
                continue
            if a["group"] == "strength" or (a["group"] == "cardio" and (item.get("summarizedExerciseSets") or a["sets"])):
                totals, miss = _session_muscles(a, item)
                unmapped.update(miss)
                if totals:
                    days[d].append({"id": a["id"], "name": a["name"], "kind": "strength", "time": a["start_local"][11:16], "muscles": totals})
            elif a["possible_hyrox"]:
                analysis = hyrox_for(a)
                totals = mx.from_hyrox(analysis)
                if totals:
                    days[d].append({"id": a["id"], "name": a["name"], "kind": "hyrox", "time": a["start_local"][11:16], "muscles": totals})
        for sessions in days.values():
            sessions.sort(key=lambda x: x["time"])
        return {"week_start": _iso(start), "week_end": _iso(end), "date": _iso(day),
                "days": [{"date": d, "sessions": v} for d, v in days.items()],
                "muscles": mx.MUSCLES, "labels": mx.LABELS, "unmapped": sorted(unmapped)}

    return cached(f"muscles_week:{_iso(day)}", _ttl_for(day), load, fresh=fresh)


# ---------------------------------------------------------------- training / performance


def training(day_str: str | None = None, fresh: bool = False) -> dict[str, Any]:
    day = _parse_date(day_str)
    d = _iso(day)

    def load() -> dict[str, Any]:
        results, errors = gather({
            "status": ("get_training_status", d),
            "readiness": ("get_training_readiness", d),
            "race": ("get_race_predictions",),
            "endurance": ("get_endurance_score", d),
            "hill": ("get_hill_score", d),
            "lt": ("get_lactate_threshold",),
            "fitness_age": ("get_fitnessage_data", d),
            "hrv": ("get_hrv_data", d),
            "acts": ("get_activities_by_date", _iso(day - timedelta(days=83)), d),
            "vo2": ("get_max_metrics_range", _iso(day - timedelta(days=364)), d),
            "records": ("get_personal_record",),
            "readiness_28": ("get_training_readiness_range", _iso(day - timedelta(days=27)), d),
        })
        acts = [n.activity_summary(a) for a in results["acts"] or []]
        load_days = {}
        for a in acts:
            if a["start_local"]:
                load_days[a["start_local"][:10]] = load_days.get(a["start_local"][:10], 0) + (a["training_load"] or 0)
        daily_load = [{"date": _iso(day - timedelta(days=i)), "value": round(load_days.get(_iso(day - timedelta(days=i)), 0))}
                      for i in range(27, -1, -1)]
        weeks = []
        for w in range(11, -1, -1):
            end = day - timedelta(days=day.weekday()) + timedelta(days=6) - timedelta(weeks=w)
            start = end - timedelta(days=6)
            wk = [a for a in acts if a["start_local"] and _iso(start) <= a["start_local"][:10] <= _iso(end)]
            weeks.append({
                "week_start": _iso(start),
                "run_km": round(sum(a["distance_m"] or 0 for a in wk if a["group"] in ("run", "hyrox")) / 1000, 1),
                "ride_km": round(sum(a["distance_m"] or 0 for a in wk if a["group"] == "ride") / 1000, 1),
                "swim_m": round(sum(a["distance_m"] or 0 for a in wk if a["group"] == "swim")),
                "hours": round(sum(a["duration_s"] or 0 for a in wk) / 3600, 1),
                "load": round(sum(a["training_load"] or 0 for a in wk)),
                "sessions": len(wk),
            })
        readiness_series = n.range_series(results["readiness_28"], ["score"])
        return {
            "date": d,
            "status": n.training_status(results["status"]),
            "readiness": n.readiness(results["readiness"]),
            "readiness_28d": readiness_series,
            "race_predictions": n.race_predictions(results["race"]),
            "endurance": n.endurance_score(results["endurance"]),
            "hill": n.hill_score(results["hill"]),
            "lactate_threshold": n.lactate_threshold(results["lt"]),
            "fitness_age": n.fitness_age(results["fitness_age"]),
            "hrv": n.hrv(results["hrv"]),
            "daily_load": daily_load,
            "weeks": weeks,
            "vo2max_history": n.range_series(results["vo2"], ["vo2MaxPreciseValue", "vo2MaxValue"]),
            "records": n.personal_records(results["records"]),
            "missing": sorted(errors),
        }

    return cached(f"training:{d}", TTL_TODAY if day >= local_today() else TTL_PAST_DAY, load, fresh=fresh)


# ---------------------------------------------------------------- trends

TRENDS: dict[str, dict[str, Any]] = {
    "sleep_score": {"method": "get_sleep_daily", "keys": ["sleepScore", "overallSleepScore", "sleepScores.overall.value"], "unit": "", "label": "Sleep score", "chunk": 0},
    "sleep_hours": {"method": "get_sleep_daily", "keys": ["totalSleepTimeInSeconds", "sleepTimeSeconds"], "scale": 1 / 3600, "unit": "h", "label": "Sleep duration", "chunk": 0},
    "hrv": {"method": "get_hrv_data_range", "keys": ["lastNightAvg"], "unit": "ms", "label": "Overnight HRV", "chunk": 28},
    "rhr": {"method": "get_rhr_daily", "keys": ["value", "restingHeartRate"], "unit": "bpm", "label": "Resting heart rate", "chunk": 0},
    "stress": {"method": "get_daily_stress_stats", "keys": ["overallStressLevel", "averageStressLevel", "avgStressLevel", "stressLevel"], "unit": "", "label": "Average stress", "chunk": 28},
    "body_battery": {"method": "get_daily_body_battery_stats", "keys": ["highBB", "bodyBatteryHigh", "highestValue", "maxBodyBattery", "high"], "unit": "", "label": "Body Battery high", "chunk": 28,
                     "low_keys": ["lowBB", "bodyBatteryLow", "lowestValue", "minBodyBattery", "low"]},
    "steps": {"method": "get_daily_steps", "keys": ["totalSteps", "steps"], "unit": "", "label": "Steps", "chunk": 0},
    "intensity": {"method": "get_daily_intensity_minutes_stats", "keys": ["moderateValue", "moderateIntensityMinutes"], "unit": "min", "label": "Intensity minutes", "chunk": 28,
                  "vig_keys": ["vigorousValue", "vigorousIntensityMinutes"]},
    "readiness": {"method": "get_training_readiness_range", "keys": ["score"], "unit": "", "label": "Training readiness", "chunk": 28},
    "vo2max": {"method": "get_max_metrics_range", "keys": ["vo2MaxPreciseValue", "vo2MaxValue"], "unit": "", "label": "VO₂ max", "chunk": 0},
    "weight": {"method": "get_body_composition", "keys": ["weight"], "unit": "kg", "label": "Weight", "chunk": 0, "grams": True},
    "respiration": {"method": "get_daily_respiration_stats", "keys": ["avgWakingRespirationValue", "avgWakingRespiration", "waking"], "unit": "brpm", "label": "Waking respiration", "chunk": 28},
    "calories": {"method": "get_calories_daily", "keys": ["activeKilocalories", "activeCalories"], "unit": "kcal", "label": "Active calories", "chunk": 28},
}


def _chunks(start: date, end: date, size: int) -> list[tuple[str, str]]:
    if size <= 0:
        return [(_iso(start), _iso(end))]
    out = []
    cur = start
    while cur <= end:
        stop = min(end, cur + timedelta(days=size - 1))
        out.append((_iso(cur), _iso(stop)))
        cur = stop + timedelta(days=1)
    return out


def trends(metric: str, days: int = 28, end_str: str | None = None) -> dict[str, Any]:
    if metric not in TRENDS and metric not in ("training_load", "run_distance"):
        raise KeyError(metric)
    days = max(7, min(366, int(days)))
    end = _parse_date(end_str)
    start = end - timedelta(days=days - 1)

    def load() -> dict[str, Any]:
        if metric in ("training_load", "run_distance"):
            raw = call("get_activities_by_date", _iso(start), _iso(end)) or []
            per: dict[str, float] = {}
            for a in map(n.activity_summary, raw):
                d = (a["start_local"] or "")[:10]
                if not d:
                    continue
                v = a["training_load"] if metric == "training_load" else ((a["distance_m"] or 0) / 1000 if a["group"] in ("run", "hyrox") else 0)
                per[d] = per.get(d, 0) + (v or 0)
            points = [{"date": _iso(start + timedelta(days=i)), "value": round(per.get(_iso(start + timedelta(days=i)), 0), 1)} for i in range(days)]
            return _with_stats(metric, "Training load" if metric == "training_load" else "Running distance",
                               "" if metric == "training_load" else "km", points)
        spec = TRENDS[metric]
        chunks = _chunks(start, end, spec["chunk"])
        results, _errors = gather({f"c{i}": (spec["method"], s, e) for i, (s, e) in enumerate(chunks)})
        rows: list[Any] = []
        for i in range(len(chunks)):
            part = results.get(f"c{i}")
            if isinstance(part, dict):
                for key in ("hrvSummaries", "individualStats", "dateWeightList"):
                    if isinstance(part.get(key), list):
                        part = part[key]
                        break
            if isinstance(part, list):
                rows.extend(part)
        scale = spec.get("scale", 1.0)
        points = n.range_series(rows, spec["keys"], scale)
        if spec.get("grams"):
            points = [{"date": p["date"], "value": round(p["value"] / 1000, 1) if p["value"] > 500 else p["value"]} for p in points]
        if metric == "intensity":
            vig = {p["date"]: p["value"] for p in n.range_series(rows, spec["vig_keys"])}
            points = [{"date": p["date"], "value": p["value"] + 2 * vig.get(p["date"], 0)} for p in points]
        out = _with_stats(metric, spec["label"], spec["unit"], points)
        if metric == "body_battery":
            low = {p["date"]: p["value"] for p in n.range_series(rows, spec["low_keys"])}
            out["points"] = [{**p, "low": low.get(p["date"])} for p in out["points"]]
        if metric == "hrv":
            base = next((r.get("baseline") for r in reversed(rows) if isinstance(r, dict) and r.get("baseline")), None) or {}
            out["band"] = {"low": base.get("balancedLow"), "high": base.get("balancedUpper")}
            weekly = {p["date"]: p["value"] for p in n.range_series(rows, ["weeklyAvg"])}
            out["points"] = [{**p, "avg7": weekly.get(p["date"])} for p in out["points"]]
        if metric in ("sleep_hours", "sleep_score"):
            stage_keys = {"deep": ["deepTime", "deepSleepSeconds"], "light": ["lightTime", "lightSleepSeconds"],
                          "rem": ["remTime", "remSleepSeconds"], "awake": ["awakeTime", "awakeSleepSeconds"]}
            stages = {k: {p["date"]: p["value"] for p in n.range_series(rows, keys, 1 / 3600)} for k, keys in stage_keys.items()}
            out["points"] = [{**p, **{k: stages[k].get(p["date"]) for k in stages}} for p in out["points"]]
        return out

    ttl = TTL_TRENDS if end >= local_today() - timedelta(days=1) else TTL_PAST_DAY
    return cached(f"trend:{metric}:{days}:{_iso(end)}", ttl, load)


def _with_stats(metric: str, label: str, unit: str, points: list[dict[str, Any]]) -> dict[str, Any]:
    vals = [p["value"] for p in points if p["value"] is not None]
    stats = None
    if vals:
        half = max(1, len(vals) // 2)
        prev = vals[:half]
        recent = vals[half:]
        stats = {"avg": round(sum(vals) / len(vals), 1), "min": min(vals), "max": max(vals), "latest": vals[-1],
                 "change": round(sum(recent) / len(recent) - sum(prev) / len(prev), 1) if recent and prev else None}
    return {"metric": metric, "label": label, "unit": unit, "points": points, "stats": stats}


# ---------------------------------------------------------------- profile extras


def profile(fresh: bool = False) -> dict[str, Any]:
    def load() -> dict[str, Any]:
        results, errors = gather({
            "badges": ("get_earned_badges",),
            "gear": ("get_gear_list",),
            "records": ("get_personal_record",),
            "devices": ("get_devices",),
            "last_used": ("get_device_last_used",),
            "totals": ("get_lifetime_totals",),
        })
        devices = [{"name": d.get("productDisplayName") or d.get("displayName"), "firmware": d.get("currentFirmwareVersion"),
                    "primary": bool(d.get("primaryActivityTrackerIndicator"))} for d in results["devices"] or [] if isinstance(d, dict)]
        last = results["last_used"] or {}
        totals = results["totals"] or {}
        return {
            **profile_basic(),
            "badges": n.badges(results["badges"]),
            "gear": n.gear(results["gear"]),
            "records": n.personal_records(results["records"]),
            "devices": devices,
            "last_sync_ms": n.to_ms(last.get("lastUsedDeviceUploadTime")),
            "lifetime": {"activities": totals.get("totalActivities"), "distance_m": n.num(totals.get("totalDistance"), 0),
                         "duration_s": n.num(totals.get("totalDuration"), 0), "steps": totals.get("totalSteps"),
                         "calories": n.num(totals.get("totalCalories"), 0), "active_days": totals.get("totalActiveDays")},
            "missing": sorted(errors),
        }

    return cached("profile", TTL_PROFILE, load, fresh=fresh)


def widget(day_str: str | None = None) -> dict[str, Any]:
    t = today(day_str)
    r, s, bb, hrv = t.get("readiness") or {}, t.get("sleep") or {}, t.get("body_battery") or {}, t.get("hrv") or {}
    latest = t.get("hyrox_recent") or t.get("latest_activity") or {}
    return {
        "date": t["date"], "readiness": r.get("score"), "readiness_level": r.get("level"),
        "body_battery": bb.get("current"), "sleep_score": s.get("score"), "sleep_s": s.get("duration_s"),
        "hrv": hrv.get("last_night"), "hrv_status": hrv.get("status"),
        "steps": t["totals"].get("steps"), "steps_goal": t["totals"].get("steps_goal"),
        "rhr": (t.get("heart_rate") or {}).get("resting"),
        "training_status": (t.get("training") or {}).get("status"),
        "latest": {"name": latest.get("name"), "group": latest.get("group"), "distance_m": latest.get("distance_m"),
                   "duration_s": latest.get("duration_s")} if latest else None,
    }


def _round_floats(obj: Any) -> Any:
    if isinstance(obj, float):
        return round(obj, 2) if not math.isnan(obj) else None
    if isinstance(obj, list):
        return [_round_floats(v) for v in obj]
    if isinstance(obj, dict):
        return {k: _round_floats(v) for k, v in obj.items()}
    return obj
