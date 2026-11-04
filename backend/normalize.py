"""Turn Garmin's raw JSON into the small, stable shapes the app and MCP tools use.

Every function is defensive: Garmin changes field names and omits data freely, so a
missing value becomes ``None`` instead of an exception.
"""

from __future__ import annotations

import math
import re
from datetime import datetime, timezone
from typing import Any, Iterable

# ---------------------------------------------------------------- generic helpers


def g(obj: Any, *path: Any, default: Any = None) -> Any:
    for key in path:
        if obj is None:
            return default
        if isinstance(key, int):
            if isinstance(obj, list) and -len(obj) <= key < len(obj):
                obj = obj[key]
            else:
                return default
        elif isinstance(obj, dict):
            obj = obj.get(key)
        else:
            return default
    return default if obj is None else obj


def num(value: Any, digits: int | None = None) -> float | int | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    if digits is None:
        return f
    if digits == 0:
        return int(round(f))
    return round(f, digits)


def first(*values: Any) -> Any:
    for v in values:
        if v is not None:
            return v
    return None


def pretty(phrase: Any) -> str | None:
    """'AEROBIC_HIGH_SHORTAGE' -> 'Aerobic high shortage'; strips trailing _1/_2."""
    if not phrase or not isinstance(phrase, str):
        return None
    text = re.sub(r"_\d+$", "", phrase).replace("_", " ").strip().lower()
    return text[:1].upper() + text[1:] if text else None


def to_ms(value: Any) -> int | None:
    """Garmin GMT timestamps come as epoch ms or 'YYYY-MM-DD[T ]HH:MM:SS[.f]'."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        v = float(value)
        return int(v if v > 1e11 else v * 1000)
    if isinstance(value, str):
        text = value.strip().replace(" ", "T")
        if text.endswith("Z"):
            text = text[:-1]
        for fmt in ("%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M"):
            try:
                dt = datetime.strptime(text, fmt).replace(tzinfo=timezone.utc)
                return int(dt.timestamp() * 1000)
            except ValueError:
                continue
    return None


def downsample(points: list[list[Any]], target: int) -> list[list[Any]]:
    """Bucket-average time series points ([t, v]) down to about ``target`` points."""
    pts = [p for p in points if p and p[-1] is not None]
    if len(pts) <= target or target <= 0:
        return pts
    size = len(pts) / target
    out = []
    for i in range(target):
        bucket = pts[int(i * size): int((i + 1) * size)] or [pts[min(len(pts) - 1, int(i * size))]]
        vals = [p[-1] for p in bucket if isinstance(p[-1], (int, float))]
        if not vals:
            continue
        out.append([bucket[len(bucket) // 2][0], round(sum(vals) / len(vals), 1)])
    return out


def series(raw: Iterable[Any], value_index: int = 1, skip_negative: bool = True) -> list[list[Any]]:
    out = []
    for row in raw or []:
        if not isinstance(row, (list, tuple)) or len(row) <= value_index:
            continue
        t = to_ms(row[0])
        v = row[value_index]
        if t is None or not isinstance(v, (int, float)):
            continue
        if skip_negative and v < 0:
            continue
        out.append([t, v])
    return out


def parse_detail_metrics(details: dict[str, Any]) -> list[dict[str, Any]]:
    """Resolve the positional ``activityDetailMetrics`` samples into dicts by key."""
    index_to_key: dict[int, str] = {}
    for d in details.get("metricDescriptors") or []:
        key, idx = d.get("key"), d.get("metricsIndex")
        if isinstance(key, str) and isinstance(idx, int) and not isinstance(idx, bool) and idx >= 0:
            index_to_key[idx] = key
    rows = []
    for sample in details.get("activityDetailMetrics") or []:
        m = sample.get("metrics") or []
        rows.append({k: m[i] for i, k in index_to_key.items() if i < len(m)})
    return rows


# ---------------------------------------------------------------- activity types

TYPE_GROUPS = {
    "run": {"running", "treadmill_running", "trail_running", "track_running", "indoor_running",
            "virtual_run", "street_running", "ultra_run", "obstacle_run"},
    "ride": {"cycling", "road_biking", "indoor_cycling", "mountain_biking", "gravel_cycling",
             "virtual_ride", "cyclocross", "e_bike_fitness", "bmx", "track_cycling"},
    "swim": {"lap_swimming", "open_water_swimming", "swimming", "multisport_swimming"},
    "strength": {"strength_training"},
    "cardio": {"hiit", "indoor_cardio", "cardio", "fitness_equipment", "elliptical",
               "stair_climbing", "indoor_rowing", "rowing", "floor_climbing", "jump_rope", "boxing"},
    "walk": {"walking", "hiking", "casual_walking", "speed_walking"},
    "mind": {"yoga", "pilates", "breathwork", "meditation"},
    "multi": {"multi_sport", "triathlon", "duathlon", "transition"},
}


def type_group(type_key: str | None) -> str:
    key = (type_key or "").lower()
    for group, keys in TYPE_GROUPS.items():
        if key in keys:
            return group
    if "run" in key:
        return "run"
    if "cycl" in key or "bik" in key:
        return "ride"
    if "swim" in key:
        return "swim"
    return "other"


def type_label(type_key: str | None) -> str:
    labels = {"lap_swimming": "Pool swim", "road_biking": "Road ride", "indoor_cardio": "Cardio",
              "hiit": "HIIT", "strength_training": "Strength", "treadmill_running": "Treadmill run",
              "multi_sport": "Multisport", "indoor_cycling": "Indoor ride", "open_water_swimming": "Open water"}
    if type_key in labels:
        return labels[type_key]
    return pretty(type_key) or "Activity"


HYROX_NAME_RE = re.compile(r"hyrox|roxzone|rox\s*sim", re.I)

TE_LABELS = {
    "AEROBIC_BASE": "Base", "TEMPO": "Tempo", "LACTATE_THRESHOLD": "Threshold",
    "VO2MAX": "VO₂ max", "ANAEROBIC_CAPACITY": "Anaerobic", "SPEED": "Sprint",
    "RECOVERY": "Recovery", "NO_BENEFIT": "No benefit",
}


def te_label(value: Any) -> str | None:
    if not value:
        return None
    return TE_LABELS.get(str(value).upper(), pretty(value))


# ---------------------------------------------------------------- activities


def activity_summary(a: dict[str, Any]) -> dict[str, Any]:
    """Normalise an item from get_activities / get_activities_by_date."""
    type_key = g(a, "activityType", "typeKey") or g(a, "activityTypeDTO", "typeKey")
    dist = num(a.get("distance"), 1) or None
    dur = num(first(a.get("duration"), a.get("elapsedDuration")), 1)
    speed = num(a.get("averageSpeed"), 4)
    name = a.get("activityName") or type_label(type_key)
    group = type_group(type_key)
    is_hyrox = bool(HYROX_NAME_RE.search(f"{name} {a.get('description') or ''}"))
    possible_hyrox = is_hyrox or (
        group in ("cardio", "multi", "run", "other")
        and 13 <= (a.get("lapCount") or 0) <= 24
        and dur is not None and 40 * 60 <= dur <= 150 * 60
    )
    zones = [num(a.get(f"hrTimeInZone_{i}"), 0) for i in range(1, 6)]
    return {
        "id": a.get("activityId"),
        "name": name,
        "type": type_key,
        "type_label": "HYROX" if is_hyrox else type_label(type_key),
        "group": "hyrox" if is_hyrox else group,
        "start_local": (a.get("startTimeLocal") or "").replace("T", " ")[:19] or None,
        "start_ms": to_ms(a.get("startTimeGMT")),
        "duration_s": dur,
        "moving_s": num(a.get("movingDuration"), 1),
        "distance_m": dist,
        "avg_speed": speed,
        "max_speed": num(a.get("maxSpeed"), 4),
        "avg_pace_s_km": round(1000 / speed, 1) if speed and speed > 0.3 and group in ("run", "walk", "hyrox") else None,
        "avg_hr": num(a.get("averageHR"), 0),
        "max_hr": num(a.get("maxHR"), 0),
        "calories": num(a.get("calories"), 0),
        "elevation_gain": num(a.get("elevationGain"), 0),
        "elevation_loss": num(a.get("elevationLoss"), 0),
        "cadence": num(first(a.get("averageRunningCadenceInStepsPerMinute"), a.get("averageBikingCadenceInRevPerMinute")), 0),
        "avg_power": num(a.get("avgPower"), 0),
        "norm_power": num(a.get("normPower"), 0),
        "te_aerobic": num(a.get("aerobicTrainingEffect"), 1),
        "te_anaerobic": num(a.get("anaerobicTrainingEffect"), 1),
        "te_label": te_label(a.get("trainingEffectLabel")),
        "training_load": num(a.get("activityTrainingLoad"), 0),
        "vo2max": num(a.get("vO2MaxValue"), 1),
        "lap_count": a.get("lapCount"),
        "has_map": bool(a.get("hasPolyline")),
        "location": a.get("locationName"),
        "steps": a.get("steps"),
        "sets": a.get("activeSets") or a.get("totalSets"),
        "reps": a.get("totalReps"),
        "volume_kg": num(a.get("totalVolume"), 0),
        "intensity_min": (a.get("moderateIntensityMinutes") or 0) + 2 * (a.get("vigorousIntensityMinutes") or 0) or None,
        "body_battery": num(a.get("differenceBodyBattery"), 0),
        "sweat_ml": num(a.get("waterEstimated"), 0),
        "hr_zones_s": zones if any(zones) else None,
        "is_hyrox": is_hyrox,
        "possible_hyrox": possible_hyrox,
        "child_ids": a.get("childIds") or g(a, "metadataDTO", "childIds"),
    }


def activity_header(raw: dict[str, Any]) -> dict[str, Any]:
    """Normalise get_activity (the single-activity summary with summaryDTO)."""
    s = raw.get("summaryDTO") or {}
    flat = {
        "activityId": raw.get("activityId"),
        "activityName": raw.get("activityName"),
        "description": raw.get("description"),
        "activityType": raw.get("activityTypeDTO") or raw.get("activityType"),
        "startTimeLocal": s.get("startTimeLocal"),
        "startTimeGMT": s.get("startTimeGMT"),
        "distance": s.get("distance"),
        "duration": s.get("duration"),
        "movingDuration": s.get("movingDuration"),
        "averageSpeed": s.get("averageSpeed"),
        "maxSpeed": s.get("maxSpeed"),
        "averageHR": s.get("averageHR"),
        "maxHR": s.get("maxHR"),
        "calories": s.get("calories"),
        "elevationGain": s.get("elevationGain"),
        "elevationLoss": s.get("elevationLoss"),
        "averageRunningCadenceInStepsPerMinute": s.get("averageRunCadence"),
        "averageBikingCadenceInRevPerMinute": s.get("averageBikeCadence"),
        "avgPower": s.get("averagePower"),
        "normPower": s.get("normalizedPower"),
        "aerobicTrainingEffect": s.get("trainingEffect"),
        "anaerobicTrainingEffect": s.get("anaerobicTrainingEffect"),
        "trainingEffectLabel": s.get("trainingEffectLabel"),
        "activityTrainingLoad": s.get("activityTrainingLoad"),
        "lapCount": g(raw, "metadataDTO", "lapCount"),
        "hasPolyline": g(raw, "metadataDTO", "hasPolyline"),
        "locationName": raw.get("locationName"),
        "steps": s.get("steps"),
        "moderateIntensityMinutes": s.get("moderateIntensityMinutes"),
        "vigorousIntensityMinutes": s.get("vigorousIntensityMinutes"),
        "differenceBodyBattery": s.get("differenceBodyBattery"),
        "waterEstimated": s.get("waterEstimated"),
        "childIds": g(raw, "metadataDTO", "childIds"),
    }
    out = activity_summary(flat)
    out.update({
        "description": raw.get("description"),
        "min_hr": num(s.get("minHR"), 0),
        "max_elevation": num(s.get("maxElevation"), 0),
        "min_elevation": num(s.get("minElevation"), 0),
        "stride_cm": num(s.get("strideLength"), 0),
        "ground_contact_ms": num(s.get("groundContactTime"), 0),
        "vertical_osc_cm": num(s.get("verticalOscillation"), 1),
        "vertical_ratio": num(s.get("verticalRatio"), 1),
        "temp_min_c": num(s.get("minTemperature"), 0),
        "temp_max_c": num(s.get("maxTemperature"), 0),
        "stamina_start": num(s.get("beginPotentialStamina"), 0),
        "stamina_end": num(s.get("endPotentialStamina"), 0),
        "stamina_min": num(s.get("minAvailableStamina"), 0),
        "recovery_hr": num(s.get("recoveryHeartRate"), 0),
        "max_power": num(s.get("maxPower"), 0),
        "max_cadence": num(s.get("maxRunCadence"), 0),
    })
    return out


DETAIL_KEYS = {
    "hr": ("directHeartRate",),
    "speed": ("directSpeed", "directEnhancedSpeed"),
    "elevation": ("directElevation", "directEnhancedElevation", "directCorrectedElevation"),
    "cadence": ("directDoubleCadence", "directRunCadence", "directBikeCadence"),
    "power": ("directPower",),
    "stamina": ("directAvailableStamina",),
    "temperature": ("directAirTemperature",),
    "respiration": ("directRespirationRate",),
    "performance_condition": ("directPerformanceCondition",),
}


def activity_streams(details: dict[str, Any] | None, max_points: int = 360) -> dict[str, Any]:
    """Turn the positional detail metrics into aligned, downsampled arrays."""
    if not details:
        return {"t": [], "distance": []}
    rows = parse_detail_metrics(details)
    if not rows:
        return {"t": [], "distance": []}

    def pick(row: dict[str, Any], keys: tuple[str, ...]) -> Any:
        for k in keys:
            if row.get(k) is not None:
                return row[k]
        return None

    t0 = None
    base = []
    for row in rows:
        t = first(row.get("sumDuration"), row.get("sumElapsedDuration"))
        if t is None and row.get("directTimestamp") is not None:
            ts = float(row["directTimestamp"])
            t0 = ts if t0 is None else t0
            t = (ts - t0) / 1000
        if t is None:
            continue
        base.append((float(t), row))
    if not base:
        return {"t": [], "distance": []}
    step = max(1, math.ceil(len(base) / max_points))
    out: dict[str, list[Any]] = {"t": [], "distance": []}
    for key in DETAIL_KEYS:
        out[key] = []
    for i in range(0, len(base), step):
        chunk = base[i: i + step]
        t, row = chunk[len(chunk) // 2]
        out["t"].append(round(t))
        out["distance"].append(num(row.get("sumDistance"), 1))
        for key, keys in DETAIL_KEYS.items():
            vals = [v for v in (pick(r, keys) for _, r in chunk) if isinstance(v, (int, float))]
            out[key].append(round(sum(vals) / len(vals), 2) if vals else None)
    # Single-leg cadence -> steps per minute
    cad = [c for c in out["cadence"] if c]
    if cad and sum(cad) / len(cad) < 110 and any(r.get("directRunCadence") for _, r in base[:50]):
        out["cadence"] = [c * 2 if c else c for c in out["cadence"]]
    for key in list(out):
        if key not in ("t", "distance") and not any(v is not None and v != 0 for v in out[key]):
            del out[key]
    return out


def activity_route(details: dict[str, Any] | None, max_points: int = 700) -> list[list[float]] | None:
    if not details:
        return None
    poly = g(details, "geoPolylineDTO", "polyline") or []
    pts = [[round(p["lat"], 6), round(p["lon"], 6)] for p in poly
           if isinstance(p, dict) and p.get("lat") is not None and p.get("lon") is not None]
    if not pts:
        rows = parse_detail_metrics(details)
        pts = [[round(r["directLatitude"], 6), round(r["directLongitude"], 6)] for r in rows
               if r.get("directLatitude") is not None and r.get("directLongitude") is not None]
    if len(pts) < 2:
        return None
    step = max(1, math.ceil(len(pts) / max_points))
    thinned = pts[::step]
    if thinned[-1] != pts[-1]:
        thinned.append(pts[-1])
    return thinned


def preview_route(route: list[list[float]] | None, n: int = 80) -> list[list[float]] | None:
    if not route:
        return None
    step = max(1, len(route) // n)
    return route[::step]


LAP_NAME_KEYS = ("lapName", "name", "wktStepName", "stepName", "label", "lapLabel", "description")


def laps(splits: dict[str, Any] | None) -> list[dict[str, Any]]:
    out = []
    for i, lap in enumerate(g(splits, "lapDTOs") or []):
        name = None
        for key in LAP_NAME_KEYS:
            if isinstance(lap.get(key), str) and lap[key].strip():
                name = lap[key].strip()
                break
        dist = num(lap.get("distance"), 1)
        dur = num(first(lap.get("duration"), lap.get("elapsedDuration")), 1)
        speed = num(lap.get("averageSpeed"), 4)
        out.append({
            "index": lap.get("lapIndex") or i + 1,
            "name": name,
            "start_ms": to_ms(lap.get("startTimeGMT")),
            "duration_s": dur,
            "distance_m": dist,
            "avg_speed": speed,
            "pace_s_km": round(dur / dist * 1000, 1) if dur and dist and dist > 50 else None,
            "avg_hr": num(lap.get("averageHR"), 0),
            "max_hr": num(lap.get("maxHR"), 0),
            "cadence": num(lap.get("averageRunCadence"), 0),
            "power": num(lap.get("averagePower"), 0),
            "elevation_gain": num(lap.get("elevationGain"), 0),
            "calories": num(lap.get("calories"), 0),
            "intensity": lap.get("intensityType"),
        })
    return out


def hr_zones(raw: Any) -> list[dict[str, Any]] | None:
    rows = raw if isinstance(raw, list) else g(raw, "hrTimeInZones") or []
    zones = [{"zone": r.get("zoneNumber"), "seconds": num(r.get("secsInZone"), 0) or 0,
              "low_bpm": num(r.get("zoneLowBoundary"), 0)} for r in rows if isinstance(r, dict)]
    return zones or None


def exercise_sets(raw: Any) -> list[dict[str, Any]] | None:
    sets = g(raw, "exerciseSets")
    if not sets:
        return None
    out = []
    for s in sets:
        if s.get("setType") != "ACTIVE":
            continue
        ex = g(s, "exercises", 0) or {}
        weight = num(s.get("weight"))
        if weight and weight > 1000:  # grams
            weight = weight / 1000
        out.append({
            "exercise": pretty(ex.get("name") or ex.get("category")) or "Exercise",
            "category": pretty(ex.get("category")),
            "reps": s.get("repetitionCount"),
            "weight_kg": round(weight, 1) if weight else None,
            "duration_s": num(s.get("duration"), 0),
        })
    return out or None


def weather(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict) or raw.get("temp") is None:
        return None
    temp_f = num(raw.get("temp"))
    feels_f = num(raw.get("apparentTemp"))
    wind = num(raw.get("windSpeed"))
    return {
        "temp_c": round((temp_f - 32) * 5 / 9) if temp_f is not None else None,
        "feels_c": round((feels_f - 32) * 5 / 9) if feels_f is not None else None,
        "humidity": num(raw.get("relativeHumidity"), 0),
        "wind_kmh": round(wind * 1.609) if wind is not None else None,
        "wind_dir": (raw.get("windDirectionCompassPoint") or "").upper() or None,
        "summary": g(raw, "weatherTypeDTO", "desc"),
    }


# ---------------------------------------------------------------- daily wellness

READINESS_TEXT = {
    "WELL_RECOVERED": "Well recovered",
    "RECOVERING_TAKE_IT_EASY": "Recovering — take it easy",
    "RECOVERED_AND_READY": "Recovered and ready",
    "WELL_RECOVERED_READY_HARD_TRAINING": "You're well recovered and ready for hard training.",
    "RECOVERING_LIGHT_TRAINING": "You're still recovering. Light training is a good call today.",
}


def readiness(raw: Any) -> dict[str, Any] | None:
    rows = raw if isinstance(raw, list) else [raw] if isinstance(raw, dict) else []
    rows = [r for r in rows if isinstance(r, dict) and r.get("score") is not None]
    if not rows:
        return None
    r = sorted(rows, key=lambda x: str(x.get("timestamp") or ""))[-1]

    def factor(pct_key: str, fb_key: str) -> dict[str, Any] | None:
        if r.get(pct_key) is None:
            return None
        return {"pct": num(r.get(pct_key), 0), "label": pretty(r.get(fb_key))}

    level = (r.get("level") or "").upper()
    return {
        "score": num(r.get("score"), 0),
        "level": level.title() if level else None,
        "headline": READINESS_TEXT.get(r.get("feedbackShort") or "", pretty(r.get("feedbackShort"))),
        "message": READINESS_TEXT.get(r.get("feedbackLong") or "", pretty(r.get("feedbackLong"))),
        "recovery_min": num(r.get("recoveryTime"), 0),
        "factors": {
            "sleep": factor("sleepScoreFactorPercent", "sleepScoreFactorFeedback"),
            "recovery": factor("recoveryTimeFactorPercent", "recoveryTimeFactorFeedback"),
            "load": factor("acwrFactorPercent", "acwrFactorFeedback"),
            "hrv": factor("hrvFactorPercent", "hrvFactorFeedback"),
            "stress": factor("stressHistoryFactorPercent", "stressHistoryFactorFeedback"),
            "sleep_history": factor("sleepHistoryFactorPercent", "sleepHistoryFactorFeedback"),
        },
        "sleep_score": num(r.get("sleepScore"), 0),
        "context": pretty(r.get("inputContext")),
    }


SLEEP_STAGE = {0: "deep", 1: "light", 2: "rem", 3: "awake"}


def sleep(raw: Any) -> dict[str, Any] | None:
    dto = g(raw, "dailySleepDTO") or {}
    if not dto or not dto.get("sleepTimeSeconds"):
        return None
    stages = []
    for lvl in g(raw, "sleepLevels") or []:
        stage = SLEEP_STAGE.get(int(lvl.get("activityLevel", -1)) if lvl.get("activityLevel") is not None else -1)
        s, e = to_ms(lvl.get("startGMT")), to_ms(lvl.get("endGMT"))
        if stage and s and e and e > s:
            stages.append({"start": s, "end": e, "stage": stage})
    scores = g(dto, "sleepScores") or {}
    sub = {}
    for key in ("totalDuration", "stress", "awakeCount", "remPercentage", "restlessness",
                "lightPercentage", "deepPercentage"):
        if isinstance(scores.get(key), dict):
            sub[key] = {"value": scores[key].get("value"), "quality": pretty(scores[key].get("qualifierKey"))}
    need = g(dto, "sleepNeed") or {}
    return {
        "score": num(g(scores, "overall", "value"), 0),
        "quality": pretty(g(scores, "overall", "qualifierKey")),
        "feedback": pretty(dto.get("sleepScoreFeedback")),
        "insight": pretty(dto.get("sleepScoreInsight")),
        "duration_s": num(dto.get("sleepTimeSeconds"), 0),
        "deep_s": num(dto.get("deepSleepSeconds"), 0),
        "light_s": num(dto.get("lightSleepSeconds"), 0),
        "rem_s": num(dto.get("remSleepSeconds"), 0),
        "awake_s": num(dto.get("awakeSleepSeconds"), 0),
        "nap_s": num(dto.get("napTimeSeconds"), 0),
        "start_ms": to_ms(dto.get("sleepStartTimestampGMT")),
        "end_ms": to_ms(dto.get("sleepEndTimestampGMT")),
        "stages": stages,
        "sub_scores": sub,
        "need_min": num(first(need.get("actual"), need.get("baseline")), 0),
        "need_feedback": pretty(need.get("feedback")),
        "avg_hrv": num(first(raw.get("avgOvernightHrv"), dto.get("avgOvernightHrv")), 0),
        "resting_hr": num(first(raw.get("restingHeartRate"), dto.get("restingHeartRate")), 0),
        "avg_spo2": num(first(dto.get("averageSpO2Value"), g(raw, "wellnessSpO2SleepSummaryDTO", "averageSPO2")), 0),
        "low_spo2": num(first(dto.get("lowestSpO2Value"), g(raw, "wellnessSpO2SleepSummaryDTO", "lowestSPO2")), 0),
        "avg_respiration": num(dto.get("averageRespirationValue"), 1),
        "avg_stress": num(dto.get("avgSleepStress"), 0),
        "restless_moments": dto.get("restlessMomentsCount"),
        "awake_count": dto.get("awakeCount"),
        "body_battery_change": num(first(raw.get("bodyBatteryChange"), dto.get("bodyBatteryChange")), 0),
    }


def hrv(raw: Any) -> dict[str, Any] | None:
    s = g(raw, "hrvSummary")
    if not s:
        return None
    base = s.get("baseline") or {}
    readings = [[to_ms(r.get("readingTimeGMT")), r.get("hrvValue")] for r in g(raw, "hrvReadings") or []
                if r.get("hrvValue") is not None]
    return {
        "last_night": num(s.get("lastNightAvg"), 0),
        "last_night_high": num(s.get("lastNight5MinHigh"), 0),
        "weekly_avg": num(s.get("weeklyAvg"), 0),
        "status": pretty(s.get("status")),
        "feedback": pretty(s.get("feedbackPhrase")),
        "baseline_low": num(base.get("balancedLow"), 0),
        "baseline_high": num(base.get("balancedUpper"), 0),
        "low_upper": num(base.get("lowUpper"), 0),
        "readings": [r for r in readings if r[0]],
    }


def body_battery(summary: Any, stress_raw: Any, events_raw: Any) -> dict[str, Any] | None:
    timeline = series(g(stress_raw, "bodyBatteryValuesArray") or [], value_index=2)
    if not timeline:
        timeline = []
    current = first(g(summary, "bodyBatteryMostRecentValue"), timeline[-1][1] if timeline else None)
    if current is None and not timeline:
        return None
    events = []
    for e in events_raw or []:
        ev = e.get("event") if isinstance(e, dict) else None
        if not ev:
            continue
        start = to_ms(ev.get("eventStartTimeGmt"))
        events.append({
            "type": pretty(ev.get("eventType")),
            "start_ms": start,
            "duration_min": round((ev.get("durationInMilliseconds") or 0) / 60000),
            "impact": num(ev.get("bodyBatteryImpact"), 0),
            "feedback": pretty(ev.get("shortFeedback")),
            "name": e.get("activityName"),
        })
    return {
        "current": num(current, 0),
        "high": num(g(summary, "bodyBatteryHighestValue"), 0),
        "low": num(g(summary, "bodyBatteryLowestValue"), 0),
        "charged": num(g(summary, "bodyBatteryChargedValue"), 0),
        "drained": num(g(summary, "bodyBatteryDrainedValue"), 0),
        "at_wake": num(g(summary, "bodyBatteryAtWakeTime"), 0),
        "timeline": downsample(timeline, 240),
        "events": events,
    }


def stress(summary: Any, stress_raw: Any) -> dict[str, Any] | None:
    timeline = series(g(stress_raw, "stressValuesArray") or [])
    avg = first(g(summary, "averageStressLevel"), g(stress_raw, "avgStressLevel"))
    if avg is None and not timeline:
        return None
    return {
        "avg": num(avg, 0),
        "max": num(first(g(summary, "maxStressLevel"), g(stress_raw, "maxStressLevel")), 0),
        "rest_s": num(g(summary, "restStressDuration"), 0),
        "low_s": num(g(summary, "lowStressDuration"), 0),
        "medium_s": num(g(summary, "mediumStressDuration"), 0),
        "high_s": num(g(summary, "highStressDuration"), 0),
        "activity_s": num(g(summary, "activityStressDuration"), 0),
        "timeline": downsample(timeline, 240),
    }


def heart_rate(summary: Any, hr_raw: Any) -> dict[str, Any] | None:
    timeline = series(g(hr_raw, "heartRateValues") or [])
    rhr = first(g(hr_raw, "restingHeartRate"), g(summary, "restingHeartRate"))
    if rhr is None and not timeline:
        return None
    return {
        "resting": num(rhr, 0),
        "min": num(first(g(hr_raw, "minHeartRate"), g(summary, "minHeartRate")), 0),
        "max": num(first(g(hr_raw, "maxHeartRate"), g(summary, "maxHeartRate")), 0),
        "resting_7d": num(first(g(hr_raw, "lastSevenDaysAvgRestingHeartRate"), g(summary, "lastSevenDaysAvgRestingHeartRate")), 0),
        "timeline": downsample(timeline, 240),
    }


def respiration(summary: Any, raw: Any) -> dict[str, Any] | None:
    timeline = series(g(raw, "respirationValuesArray") or [])
    waking = first(g(raw, "avgWakingRespirationValue"), g(summary, "avgWakingRespirationValue"))
    if waking is None and not timeline:
        return None
    return {
        "waking": num(waking, 1),
        "sleeping": num(g(raw, "avgSleepRespirationValue"), 1),
        "high": num(first(g(raw, "highestRespirationValue"), g(summary, "highestRespirationValue")), 1),
        "low": num(first(g(raw, "lowestRespirationValue"), g(summary, "lowestRespirationValue")), 1),
        "timeline": downsample(timeline, 200),
    }


def spo2(summary: Any, raw: Any) -> dict[str, Any] | None:
    avg = first(g(raw, "averageSpO2"), g(summary, "averageSpo2"))
    if avg is None:
        return None
    return {
        "avg": num(avg, 0),
        "low": num(first(g(raw, "lowestSpO2"), g(summary, "lowestSpo2")), 0),
        "latest": num(first(g(raw, "latestSpO2"), g(summary, "latestSpo2")), 0),
        "sleep_avg": num(g(raw, "avgSleepSpO2"), 0),
        "hourly": series(g(raw, "spO2HourlyAverages") or []),
    }


def daily_totals(summary: Any) -> dict[str, Any]:
    s = summary or {}
    return {
        "steps": num(s.get("totalSteps"), 0),
        "steps_goal": num(s.get("dailyStepGoal"), 0),
        "distance_m": num(s.get("totalDistanceMeters"), 0),
        "floors_up": num(s.get("floorsAscended"), 0),
        "floors_down": num(s.get("floorsDescended"), 0),
        "floors_goal": num(s.get("userFloorsAscendedGoal"), 0),
        "calories_total": num(s.get("totalKilocalories"), 0),
        "calories_active": num(s.get("activeKilocalories"), 0),
        "calories_bmr": num(s.get("bmrKilocalories"), 0),
        "calories_consumed": num(s.get("consumedKilocalories"), 0),
        "intensity_moderate": num(s.get("moderateIntensityMinutes"), 0),
        "intensity_vigorous": num(s.get("vigorousIntensityMinutes"), 0),
        "intensity_goal": num(s.get("intensityMinutesGoal"), 0),
        "active_s": num(s.get("activeSeconds"), 0),
        "highly_active_s": num(s.get("highlyActiveSeconds"), 0),
        "sedentary_s": num(s.get("sedentarySeconds"), 0),
        "sleeping_s": num(s.get("sleepingSeconds"), 0),
    }


def hydration(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict) or raw.get("goalInML") is None and raw.get("valueInML") is None:
        return None
    return {"intake_ml": num(raw.get("valueInML"), 0), "goal_ml": num(raw.get("goalInML"), 0),
            "sweat_ml": num(raw.get("sweatLossInML"), 0)}


def weight_entries(raw: Any) -> list[dict[str, Any]]:
    rows = g(raw, "dateWeightList") if isinstance(raw, dict) else raw
    out = []
    for r in rows or []:
        if not isinstance(r, dict):
            continue
        w = num(first(r.get("weight"), g(r, "values", "weight")))
        if w is None:
            continue
        kg = w / 1000 if w > 500 else w
        out.append({
            "date": r.get("calendarDate") or (datetime.fromtimestamp((to_ms(r.get("date")) or 0) / 1000, tz=timezone.utc).date().isoformat() if r.get("date") else None),
            "kg": round(kg, 1),
            "bmi": num(r.get("bmi"), 1),
            "body_fat": num(r.get("bodyFat"), 1),
            "muscle_kg": round(num(r.get("muscleMass")) / 1000, 1) if num(r.get("muscleMass")) and num(r.get("muscleMass")) > 500 else num(r.get("muscleMass"), 1),
        })
    out.sort(key=lambda x: x["date"] or "")
    return out


# ---------------------------------------------------------------- performance

STATUS_TEXT = {
    "PRODUCTIVE": "Productive", "MAINTAINING": "Maintaining", "RECOVERY": "Recovery",
    "PEAKING": "Peaking", "OVERREACHING": "Overreaching", "UNPRODUCTIVE": "Unproductive",
    "DETRAINING": "Detraining", "STRAINED": "Strained", "NO_STATUS": "No status",
}


def _primary(mapping: Any) -> dict[str, Any] | None:
    if not isinstance(mapping, dict) or not mapping:
        return None
    values = [v for v in mapping.values() if isinstance(v, dict)]
    for v in values:
        if v.get("primaryTrainingDevice"):
            return v
    return values[0] if values else None


def training_status(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    status = _primary(g(raw, "mostRecentTrainingStatus", "latestTrainingStatusData"))
    balance = _primary(g(raw, "mostRecentTrainingLoadBalance", "metricsTrainingLoadBalanceDTOMap"))
    vo2 = g(raw, "mostRecentVO2Max") or {}
    acute = g(status, "acuteTrainingLoadDTO") or {}
    phrase = (status or {}).get("trainingStatusFeedbackPhrase") or ""
    key = re.sub(r"_\d+$", "", phrase)
    focus = None
    if balance:
        def band(prefix: str) -> dict[str, Any]:
            return {"value": num(balance.get(f"monthlyLoad{prefix}"), 0),
                    "min": num(balance.get(f"monthlyLoad{prefix}TargetMin"), 0),
                    "max": num(balance.get(f"monthlyLoad{prefix}TargetMax"), 0)}
        focus = {"low_aerobic": band("AerobicLow"), "high_aerobic": band("AerobicHigh"),
                 "anaerobic": band("Anaerobic"), "feedback": pretty(balance.get("trainingBalanceFeedbackPhrase"))}
    heat = vo2.get("heatAltitudeAcclimation") or {}
    return {
        "status": STATUS_TEXT.get(key, pretty(key)) if key else None,
        "feedback": pretty(phrase),
        "acute_load": num(acute.get("dailyTrainingLoadAcute"), 0),
        "chronic_load": num(acute.get("dailyTrainingLoadChronic"), 0),
        "chronic_min": num(acute.get("minTrainingLoadChronic"), 0),
        "chronic_max": num(acute.get("maxTrainingLoadChronic"), 0),
        "acwr": num(acute.get("dailyAcuteChronicWorkloadRatio"), 2),
        "acwr_status": pretty(acute.get("acwrStatus")),
        "load_focus": focus,
        "vo2max": num(first(g(vo2, "generic", "vo2MaxPreciseValue"), g(vo2, "generic", "vo2MaxValue")), 1),
        "vo2max_cycling": num(first(g(vo2, "cycling", "vo2MaxPreciseValue"), g(vo2, "cycling", "vo2MaxValue")), 1),
        "fitness_age": num(g(vo2, "generic", "fitnessAge"), 0),
        "heat_acclimation_pct": num(heat.get("heatAcclimationPercentage"), 0),
        "heat_trend": pretty(heat.get("heatTrend")),
        "altitude_acclimation_m": num(heat.get("altitudeAcclimation"), 0),
        "altitude_trend": pretty(heat.get("altitudeTrend")),
    }


def race_predictions(raw: Any) -> dict[str, Any] | None:
    r = raw[0] if isinstance(raw, list) and raw else raw
    if not isinstance(r, dict):
        return None
    out = {"5k": num(r.get("time5K"), 0), "10k": num(r.get("time10K"), 0),
           "half": num(r.get("timeHalfMarathon"), 0), "marathon": num(r.get("timeMarathon"), 0)}
    return out if any(out.values()) else None


ENDURANCE_LEVELS = [("Recreational", "gaugeLowerLimit"), ("Intermediate", "classificationLowerLimitIntermediate"),
                    ("Trained", "classificationLowerLimitTrained"), ("Well-trained", "classificationLowerLimitWellTrained"),
                    ("Expert", "classificationLowerLimitExpert"), ("Superior", "classificationLowerLimitSuperior"),
                    ("Elite", "classificationLowerLimitElite")]


def endurance_score(raw: Any) -> dict[str, Any] | None:
    r = g(raw, "enduranceScoreDTO") or raw
    if not isinstance(r, dict) or r.get("overallScore") is None:
        return None
    score = num(r.get("overallScore"), 0)
    levels = [{"label": label, "from": num(r.get(key), 0)} for label, key in ENDURANCE_LEVELS if r.get(key) is not None]
    label = None
    for lvl in levels:
        if score is not None and lvl["from"] is not None and score >= lvl["from"]:
            label = lvl["label"]
    return {"score": score, "level": label, "levels": levels, "max": num(r.get("gaugeUpperLimit"), 0)}


def hill_score(raw: Any) -> dict[str, Any] | None:
    r = raw
    if isinstance(raw, dict) and isinstance(raw.get("hillScoreDTOList"), list) and raw["hillScoreDTOList"]:
        r = raw["hillScoreDTOList"][-1]
    if not isinstance(r, dict) or r.get("overallScore") is None:
        return None
    return {"score": num(r.get("overallScore"), 0), "strength": num(r.get("strengthScore"), 0),
            "endurance": num(r.get("enduranceScore"), 0)}


def lactate_threshold(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    sh = raw.get("speed_and_heart_rate") or {}
    pw = raw.get("power") or {}
    speed = num(sh.get("speed"))
    # Garmin reports LT speed in units of 10 m/s for some endpoints.
    if speed and speed < 1:
        speed = speed * 10
    hr = num(sh.get("heartRate"), 0)
    if not hr and not speed:
        return None
    return {"heart_rate": hr, "pace_s_km": round(1000 / speed) if speed else None,
            "power": num(pw.get("functionalThresholdPower"), 0), "power_to_weight": num(pw.get("powerToWeight"), 2)}


def fitness_age(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict) or raw.get("fitnessAge") is None:
        return None
    return {"fitness_age": num(raw.get("fitnessAge"), 1), "age": num(raw.get("chronologicalAge"), 0),
            "achievable": num(raw.get("achievableFitnessAge"), 1)}


PR_TYPES = {1: ("1 km", "time"), 2: ("1 mile", "time"), 3: ("5 km", "time"), 4: ("10 km", "time"),
            5: ("Half marathon", "time"), 6: ("Marathon", "time"), 7: ("Longest run", "distance"),
            8: ("Longest ride", "distance"), 9: ("Total ascent", "elevation"), 10: ("Max avg power (20 min)", "power"),
            12: ("Most steps in a day", "steps"), 13: ("Most steps in a week", "steps"), 14: ("Most steps in a month", "steps"),
            15: ("Most steps in a day", "steps"), 17: ("Longest swim", "distance"), 18: ("100 m swim", "time"),
            19: ("400 m swim", "time"), 20: ("1500 m swim", "time")}


def personal_records(raw: Any) -> list[dict[str, Any]]:
    rows = raw if isinstance(raw, list) else g(raw, "personalRecords") or []
    out = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        label, kind = PR_TYPES.get(r.get("typeId"), (pretty(r.get("typeKey")) or "Record", "value"))
        out.append({"label": label, "kind": kind, "value": num(r.get("value"), 1),
                    "date": (r.get("prStartTimeGmtFormatted") or r.get("prStartTimeLocalFormatted") or "")[:10] or None,
                    "activity_id": r.get("activityId"), "activity_name": r.get("activityName"),
                    "sport": r.get("activityType")})
    return out


def badges(raw: Any) -> list[dict[str, Any]]:
    out = []
    for b in raw or []:
        if isinstance(b, dict):
            out.append({"name": b.get("badgeName"), "date": (b.get("badgeEarnedDate") or "")[:10] or None,
                        "points": b.get("badgePoints"), "count": b.get("badgeEarnedNumber")})
    out.sort(key=lambda x: x["date"] or "", reverse=True)
    return out


def gear(raw: Any) -> list[dict[str, Any]]:
    rows = raw if isinstance(raw, list) else g(raw, "gearList") or []
    out = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        out.append({"name": r.get("displayName") or r.get("customMakeModel") or r.get("gearMakeName"),
                    "type": r.get("gearTypeName"), "status": r.get("gearStatusName"),
                    "distance_m": num(r.get("totalDistance"), 0), "max_m": num(r.get("maximumMeters"), 0),
                    "activities": r.get("totalActivities"), "since": (r.get("dateBegin") or "")[:10] or None})
    return out


def next_workout(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict) or not raw:
        return None
    return {"name": raw.get("title") or raw.get("workoutName"), "date": raw.get("date"),
            "sport": raw.get("sportTypeKey"), "description": raw.get("description"),
            "duration_s": num(raw.get("duration"), 0), "distance_m": num(raw.get("distance"), 0)}


# ---------------------------------------------------------------- range series


def date_of(row: dict[str, Any]) -> str | None:
    for key in ("calendarDate", "date", "summaryDate", "startDate"):
        v = row.get(key)
        if isinstance(v, str) and len(v) >= 10:
            return v[:10]
    return None


def pick_value(row: dict[str, Any], keys: Iterable[str]) -> float | None:
    values = row.get("values") if isinstance(row.get("values"), dict) else {}
    for key in keys:
        for source in (values, row):
            v = g(source, *key.split(".")) if "." in key else source.get(key)
            if isinstance(v, (int, float)) and not isinstance(v, bool):
                return float(v)
    return None


def range_series(rows: Any, keys: Iterable[str], scale: float = 1.0) -> list[dict[str, Any]]:
    keys = list(keys)
    if isinstance(rows, dict):
        for k in ("individualStats", "hrvSummaries", "values", "dailyStats", "data"):
            if isinstance(rows.get(k), list):
                rows = rows[k]
                break
    out = {}
    for r in rows or []:
        if not isinstance(r, dict):
            continue
        d = date_of(r) or date_of(r.get("generic") or {})
        v = pick_value(r, keys)
        if v is None and isinstance(r.get("generic"), dict):
            v = pick_value(r["generic"], keys)
        if d and v is not None:
            out[d] = round(v * scale, 2)
    return [{"date": d, "value": out[d]} for d in sorted(out)]
