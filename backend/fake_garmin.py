"""A stand-in for ``garminconnect.Garmin`` that returns realistic, Garmin-shaped JSON.

It lets the whole stack (normalisers, API, MCP server, app) run without an account,
and powers the app's sample-data mode. Everything is deterministic: the same date
always produces the same numbers.
"""

from __future__ import annotations

import hashlib
import math
import random
from datetime import date, datetime, timedelta, timezone
from typing import Any

TZ_OFFSET = timedelta(hours=2)  # SAST, no daylight saving
CENTER = (-25.7545, 28.2314)  # Pretoria
MAX_HR = 196
HR_ZONE_LOWS = [98, 118, 137, 157, 176]

HYROX_STATIONS = [
    ("SkiErg", 255, 1000),
    ("Sled Push", 205, 50),
    ("Sled Pull", 265, 50),
    ("Burpee Broad Jumps", 290, 80),
    ("Row", 262, 1000),
    ("Farmers Carry", 118, 200),
    ("Sandbag Lunges", 268, 100),
    ("Wall Balls", 355, 100),
]


def _rng(*parts: Any) -> random.Random:
    seed = hashlib.sha256("|".join(map(str, parts)).encode()).hexdigest()
    return random.Random(int(seed[:16], 16))


def _d(value: str | date) -> date:
    return value if isinstance(value, date) else date.fromisoformat(str(value)[:10])


def _local_today() -> date:
    return (datetime.now(timezone.utc) + TZ_OFFSET).date()


def _ms(dt: datetime) -> int:
    return int(dt.replace(tzinfo=timezone.utc).timestamp() * 1000)


def _gmt(local: datetime) -> datetime:
    return local - TZ_OFFSET


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S.0")


class FakeGarmin:
    _shared: "FakeGarmin | None" = None

    @classmethod
    def shared(cls) -> "FakeGarmin":
        if cls._shared is None or cls._shared.today != _local_today():
            cls._shared = cls()
        return cls._shared

    def __init__(self, today: date | None = None) -> None:
        self.today = today or _local_today()
        self.display_name = "demo-athlete"
        self.full_name = "Ben"
        self._activities = self._build_activities()
        self._by_id = {a["activityId"]: a for a in self._activities}

    # ------------------------------------------------------------ profile
    def get_full_name(self) -> str:
        return self.full_name

    def get_unit_system(self) -> str:
        return "metric"

    def get_user_timezone(self) -> str:
        return "Africa/Johannesburg"

    def get_user_profile(self) -> dict[str, Any]:
        return {"userData": {"measurementSystem": "metric", "gender": "MALE",
                             "weight": 78000.0, "height": 181.0, "vo2MaxRunning": 56}}

    # ------------------------------------------------------------ physiology model
    def _load(self, day: date) -> float:
        return sum(a["activityTrainingLoad"] or 0 for a in self._activities_on(day))

    def _fatigue(self, day: date) -> float:
        prev = self._load(day - timedelta(days=1))
        prev2 = self._load(day - timedelta(days=2))
        return min(1.0, (prev * 0.8 + prev2 * 0.3) / 320)

    def _day(self, day: date) -> dict[str, Any]:
        r = _rng("day", day.isoformat())
        f = self._fatigue(day)
        sleep_h = max(5.2, min(9.1, r.gauss(7.25, 0.62)))
        if day.weekday() in (4, 5):
            sleep_h += 0.35
        sleep_s = int(sleep_h * 3600)
        deep = int(sleep_s * r.uniform(0.15, 0.23))
        rem = int(sleep_s * r.uniform(0.19, 0.26))
        awake = int(r.uniform(6, 34) * 60)
        light = sleep_s - deep - rem
        score = int(max(41, min(96, 46 + (sleep_h - 5.4) * 13 + r.gauss(0, 5) - f * 6)))
        rhr = int(round(49 + f * 3.5 + r.gauss(0, 1.3)))
        hrv = int(round(81 - f * 13 + r.gauss(0, 6) + (score - 75) * 0.12))
        stress = int(max(14, min(52, r.gauss(27, 6) + f * 6)))
        bb_high = int(max(38, min(100, 34 + score * 0.68 + r.gauss(0, 4) - f * 5)))
        bb_low = int(max(5, min(bb_high - 25, r.gauss(19, 6))))
        acts = self._activities_on(day)
        steps = int(r.gauss(8600, 1900) + sum((a.get("steps") or 0) for a in acts))
        readiness = int(max(8, min(98, score * 0.45 + (hrv - 55) * 0.85 - f * 28 + r.gauss(12, 4))))
        days_ago = (self.today - day).days
        vo2 = 53.6 + 2.6 / (1 + math.exp((days_ago - 170) / 45.0))
        return {
            "sleep_s": sleep_s, "deep": deep, "rem": rem, "light": light, "awake": awake,
            "score": score, "rhr": rhr, "hrv": hrv, "stress": stress, "bb_high": bb_high,
            "bb_low": bb_low, "steps": max(1500, steps), "readiness": readiness,
            "vo2": round(vo2, 1), "fatigue": f, "resp_sleep": round(r.gauss(13.6, 0.5), 1),
            "resp_wake": round(r.gauss(15.4, 0.6), 1), "spo2": int(r.gauss(95.6, 1.1)),
            "spo2_low": int(r.gauss(89.5, 1.5)), "moderate": int(r.uniform(5, 40)),
            "bed_min": int(r.gauss(22 * 60 + 40, 25)),
        }

    def _hrv_baseline(self) -> dict[str, float]:
        return {"lowUpper": 58.0, "balancedLow": 66.0, "balancedUpper": 90.0, "markerValue": 0.52}

    # ------------------------------------------------------------ activities
    def _activities_on(self, day: date) -> list[dict[str, Any]]:
        return [a for a in self._activities if a["startTimeLocal"][:10] == day.isoformat()]

    def _build_activities(self) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        start = self.today - timedelta(days=400)
        race_day = self.today - timedelta(days=38)
        unnamed_sim = self.today - timedelta(days=9)
        d = start
        week = 0
        while d <= self.today:
            r = _rng("plan", d.isoformat())
            wd = d.weekday()
            days_ago = (self.today - d).days
            specs: list[dict[str, Any]] = []
            if days_ago == 0:
                specs.append({"kind": "easy_run", "hour": 6.1, "km": 7.2})
            elif days_ago == 1:
                specs.append({"kind": "hyrox", "hour": 17.4, "named": True, "label": "HYROX simulation"})
            elif d == race_day:
                specs.append({"kind": "hyrox", "hour": 10.2, "named": True, "label": "HYROX race — Men's Open", "race": True})
            elif d == unnamed_sim:
                specs.append({"kind": "hyrox", "hour": 16.9, "named": False, "label": "Hyrox sim"})
            elif wd == 0:
                specs.append({"kind": "easy_run", "hour": 6.0, "km": r.uniform(7.5, 9.5)})
            elif wd == 1:
                specs.append({"kind": "strength", "hour": 17.5})
            elif wd == 2:
                specs.append({"kind": "intervals" if week % 2 == 0 else "tempo", "hour": 6.1})
            elif wd == 3:
                specs.append({"kind": "compromised", "hour": 17.6})
            elif wd == 4:
                if week % 2 == 1:
                    specs.append({"kind": "swim", "hour": 6.3})
            elif wd == 5:
                if r.random() < 0.9:
                    specs.append({"kind": "long_run", "hour": 6.4, "km": r.uniform(13.5, 18.5)})
            elif wd == 6:
                if r.random() < 0.6:
                    specs.append({"kind": "ride", "hour": 7.0, "km": r.uniform(38, 62)})
            if wd == 6:
                week += 1
            for slot, spec in enumerate(specs):
                out.append(self._make_activity(d, slot, spec))
            d += timedelta(days=1)
        out.sort(key=lambda a: a["startTimeGMT"], reverse=True)
        return out

    def _make_activity(self, day: date, slot: int, spec: dict[str, Any]) -> dict[str, Any]:
        r = _rng("act", day.isoformat(), slot)
        aid = 21000000000 + day.toordinal() * 10 + slot
        local = datetime.combine(day, datetime.min.time()) + timedelta(hours=spec["hour"])
        kind = spec["kind"]
        type_key, name, dist, dur, avg_hr, max_hr, te_a, te_an, label = "running", "Run", 0.0, 0.0, 0, 0, 0.0, 0.0, "AEROBIC_BASE"
        elev = 0.0
        sets = None
        cadence = None
        power = None
        laps = 0
        if kind in ("easy_run", "long_run"):
            km = spec["km"]
            pace = r.uniform(322, 345) if kind == "easy_run" else r.uniform(330, 352)
            dist, dur = km * 1000, km * pace
            avg_hr = int(r.uniform(138, 147)) + (4 if kind == "long_run" else 0)
            max_hr = avg_hr + int(r.uniform(12, 20))
            te_a, te_an = (round(r.uniform(2.6, 3.2), 1), round(r.uniform(0.0, 0.6), 1))
            if kind == "long_run":
                te_a = round(r.uniform(3.4, 4.1), 1)
            name = "Pretoria Easy Run" if kind == "easy_run" else "Pretoria Long Run"
            elev = km * r.uniform(9, 14)
            cadence, power, laps = r.uniform(170, 176), r.uniform(255, 275), math.ceil(km)
        elif kind in ("intervals", "tempo"):
            km = 9.6 if kind == "intervals" else r.uniform(9, 11)
            pace = 300 if kind == "intervals" else r.uniform(285, 298)
            dist, dur = km * 1000, km * pace
            avg_hr, max_hr = int(r.uniform(156, 164)), int(r.uniform(183, 190))
            te_a, te_an = round(r.uniform(3.6, 4.3), 1), round(r.uniform(2.4, 3.4), 1) if kind == "intervals" else round(r.uniform(1.0, 1.9), 1)
            label = "VO2MAX" if kind == "intervals" else "TEMPO"
            name = "6 × 800 m" if kind == "intervals" else "Tempo Run"
            elev = km * 6
            cadence, power, laps = r.uniform(176, 184), r.uniform(290, 320), 14 if kind == "intervals" else math.ceil(km)
        elif kind == "strength":
            type_key, name = "strength_training", "Strength"
            dur = r.uniform(50, 62) * 60
            avg_hr, max_hr = int(r.uniform(108, 120)), int(r.uniform(150, 162))
            te_a, te_an, label = round(r.uniform(1.6, 2.4), 1), round(r.uniform(1.0, 2.0), 1), "ANAEROBIC_CAPACITY"
            sets = 18
        elif kind == "compromised":
            type_key, name = "indoor_cardio", "Compromised running"
            dur = r.uniform(55, 66) * 60
            dist = 5000.0
            avg_hr, max_hr = int(r.uniform(150, 158)), int(r.uniform(178, 186))
            te_a, te_an, label = round(r.uniform(3.4, 4.0), 1), round(r.uniform(2.0, 3.0), 1), "LACTATE_THRESHOLD"
            laps = 10
        elif kind == "swim":
            type_key, name = "lap_swimming", "Pool Swim"
            dist = float(int(r.uniform(18, 26)) * 100)
            dur = dist / 100 * r.uniform(108, 118)
            avg_hr, max_hr = int(r.uniform(128, 138)), int(r.uniform(155, 165))
            te_a, te_an = round(r.uniform(2.4, 3.1), 1), round(r.uniform(0.2, 1.0), 1)
            laps = int(dist / 100)
        elif kind == "ride":
            type_key, name = "road_biking", "Sunday Ride"
            dist = spec["km"] * 1000
            dur = dist / r.uniform(7.6, 8.6)
            avg_hr, max_hr = int(r.uniform(128, 140)), int(r.uniform(160, 172))
            te_a, te_an = round(r.uniform(2.8, 3.6), 1), round(r.uniform(0.0, 0.8), 1)
            elev = spec["km"] * r.uniform(8, 12)
            power, laps = r.uniform(185, 215), math.ceil(spec["km"] / 5)
        elif kind == "hyrox":
            type_key = "indoor_cardio" if spec.get("named") else "hiit"
            name = spec["label"]
            plan = self._hyrox_plan(day, slot, spec.get("race", False))
            dur = sum(p["duration"] for p in plan)
            dist = sum(p["distance"] for p in plan if p["kind"] == "run")
            avg_hr, max_hr = int(r.uniform(166, 172)), int(r.uniform(186, 192))
            te_a, te_an, label = round(r.uniform(4.4, 5.0), 1), round(r.uniform(3.2, 4.0), 1), "LACTATE_THRESHOLD"
            laps = len(plan)
            cadence = 168
        load = int(dur / 60 * (avg_hr - 95) / 34 * (1 + te_an / 6)) if avg_hr else 0
        gmt = _gmt(local)
        item: dict[str, Any] = {
            "activityId": aid,
            "activityName": name,
            "description": None,
            "startTimeLocal": local.strftime("%Y-%m-%d %H:%M:%S"),
            "startTimeGMT": gmt.strftime("%Y-%m-%d %H:%M:%S"),
            "activityType": {"typeKey": type_key, "typeId": 1, "parentTypeId": 17},
            "distance": round(dist, 1) if dist else 0.0,
            "duration": round(dur, 1),
            "elapsedDuration": round(dur + r.uniform(0, 40), 1),
            "movingDuration": round(dur - r.uniform(0, 30), 1),
            "elevationGain": round(elev, 1) if elev else None,
            "elevationLoss": round(elev * 0.97, 1) if elev else None,
            "averageSpeed": round(dist / dur, 3) if dist else 0.0,
            "maxSpeed": round(dist / dur * 1.35, 3) if dist else 0.0,
            "calories": round(dur / 60 * (avg_hr - 40) / 9.4, 0),
            "averageHR": float(avg_hr),
            "maxHR": float(max_hr),
            "averageRunningCadenceInStepsPerMinute": round(cadence, 1) if cadence else None,
            "maxRunningCadenceInStepsPerMinute": round(cadence + 18, 1) if cadence else None,
            "steps": int(dur / 60 * cadence) if cadence else None,
            "aerobicTrainingEffect": te_a,
            "anaerobicTrainingEffect": te_an,
            "trainingEffectLabel": label,
            "activityTrainingLoad": float(load),
            "vO2MaxValue": 56.0 if type_key == "running" else None,
            "avgPower": round(power, 0) if power else None,
            "normPower": round(power * 1.04, 0) if power else None,
            "lapCount": laps or 1,
            "hasPolyline": type_key in ("running", "road_biking"),
            "locationName": "Pretoria" if type_key in ("running", "road_biking") else None,
            "totalSets": sets,
            "activeSets": sets,
            "totalReps": sets * 8 if sets else None,
            "moderateIntensityMinutes": int(dur / 60 * 0.4),
            "vigorousIntensityMinutes": int(dur / 60 * 0.5),
            "differenceBodyBattery": -int(dur / 60 * 0.35),
            "avgStrideLength": 118.0 if type_key == "running" else None,
            "avgVerticalOscillation": 8.6 if type_key == "running" else None,
            "avgGroundContactTime": 238.0 if type_key == "running" else None,
            "waterEstimated": int(dur / 60 * 11),
            "_kind": kind,
            "_spec": spec,
        }
        return item

    def _hyrox_plan(self, day: date, slot: int, race: bool) -> list[dict[str, Any]]:
        r = _rng("hyrox", day.isoformat(), slot)
        plan = []
        base = r.uniform(268, 282) - (6 if race else 0)
        for i, (station, secs, _meters) in enumerate(HYROX_STATIONS):
            pace = base * (1 + 0.018 * i + r.uniform(-0.01, 0.025))
            plan.append({"kind": "run", "name": f"Run {i + 1}", "distance": 1000.0, "duration": pace})
            plan.append({"kind": "station", "name": station, "distance": 0.0,
                         "duration": secs * r.uniform(0.92, 1.1) * (0.96 if race else 1)})
        return plan

    def get_activities(self, start: int = 0, limit: int = 20, activitytype: str | None = None, *_: Any) -> list[dict[str, Any]]:
        items = [a for a in self._activities if not activitytype or a["activityType"]["typeKey"] == activitytype]
        return [self._public(a) for a in items[start:start + limit]]

    def get_activities_by_date(self, startdate: str, enddate: str | None = None, activitytype: str | None = None, *_: Any) -> list[dict[str, Any]]:
        s, e = _d(startdate), _d(enddate or self.today)
        return [self._public(a) for a in self._activities
                if s <= _d(a["startTimeLocal"]) <= e
                and (not activitytype or a["activityType"]["typeKey"] == activitytype)]

    def get_last_activity(self) -> dict[str, Any]:
        return self._public(self._activities[0])

    @staticmethod
    def _public(a: dict[str, Any]) -> dict[str, Any]:
        return {k: v for k, v in a.items() if not k.startswith("_")}

    def get_activity(self, activity_id: Any) -> dict[str, Any]:
        a = self._by_id[int(activity_id)]
        return {
            "activityId": a["activityId"],
            "activityName": a["activityName"],
            "description": a["description"],
            "locationName": a["locationName"],
            "activityTypeDTO": a["activityType"],
            "summaryDTO": {
                "startTimeLocal": a["startTimeLocal"].replace(" ", "T") + ".0",
                "startTimeGMT": a["startTimeGMT"].replace(" ", "T") + ".0",
                "distance": a["distance"], "duration": a["duration"],
                "movingDuration": a["movingDuration"], "elapsedDuration": a["elapsedDuration"],
                "elevationGain": a["elevationGain"], "elevationLoss": a["elevationLoss"],
                "maxElevation": 1420.0 if a["elevationGain"] else None,
                "minElevation": 1318.0 if a["elevationGain"] else None,
                "averageSpeed": a["averageSpeed"], "maxSpeed": a["maxSpeed"],
                "averageHR": a["averageHR"], "maxHR": a["maxHR"], "minHR": 92.0,
                "calories": a["calories"], "averageRunCadence": a["averageRunningCadenceInStepsPerMinute"],
                "maxRunCadence": a["maxRunningCadenceInStepsPerMinute"],
                "trainingEffect": a["aerobicTrainingEffect"],
                "anaerobicTrainingEffect": a["anaerobicTrainingEffect"],
                "trainingEffectLabel": a["trainingEffectLabel"],
                "activityTrainingLoad": a["activityTrainingLoad"],
                "averagePower": a["avgPower"], "normalizedPower": a["normPower"],
                "groundContactTime": a["avgGroundContactTime"], "strideLength": a["avgStrideLength"],
                "verticalOscillation": a["avgVerticalOscillation"], "verticalRatio": 7.3 if a["avgVerticalOscillation"] else None,
                "minTemperature": 17.0, "maxTemperature": 24.0,
                "moderateIntensityMinutes": a["moderateIntensityMinutes"],
                "vigorousIntensityMinutes": a["vigorousIntensityMinutes"],
                "steps": a["steps"], "differenceBodyBattery": a["differenceBodyBattery"],
                "waterEstimated": a["waterEstimated"],
                "beginPotentialStamina": 100.0, "endPotentialStamina": 58.0, "minAvailableStamina": 31.0,
                "recoveryHeartRate": 128.0,
            },
            "metadataDTO": {"lapCount": a["lapCount"], "hasPolyline": a["hasPolyline"],
                            "deviceMetaDataDTO": {"deviceId": 3442975544, "deviceTypePk": 36011}},
        }

    # Second-by-second-ish streams, shared by details/splits/zones.
    def _stream(self, aid: int) -> dict[str, Any]:
        a = self._by_id[int(aid)]
        kind = a["_kind"]
        r = _rng("stream", aid)
        dur = a["duration"]
        step = 5 if dur < 3600 * 1.2 else 10
        n = int(dur // step) + 1
        start_gmt = datetime.strptime(a["startTimeGMT"], "%Y-%m-%d %H:%M:%S")
        dist = a["distance"] or 0.0
        segments = self._segments(a)
        rows = []
        cum = 0.0
        hr = 95.0
        elev = 1352.0
        seg_i = 0
        seg_t = 0.0
        for i in range(n):
            t = i * step
            while seg_i < len(segments) - 1 and t > seg_t + segments[seg_i]["duration"]:
                seg_t += segments[seg_i]["duration"]
                seg_i += 1
            seg = segments[seg_i]
            target_hr = seg["hr"]
            hr += (target_hr - hr) * (0.06 if target_hr > hr else 0.09) + r.gauss(0, 0.9)
            speed = seg["speed"] * (1 + r.gauss(0, 0.035)) if seg["speed"] else 0.0
            cum += speed * step
            elev += math.sin(t / 380.0) * 0.8 + r.gauss(0, 0.15)
            rows.append({
                "t": t, "ts": _ms(start_gmt + timedelta(seconds=t)), "hr": round(hr),
                "speed": round(speed, 3), "dist": round(min(cum, dist) if dist else cum, 1),
                "elev": round(elev, 1), "seg": seg_i,
                "cad": round(seg["cad"] + r.gauss(0, 2), 1) if seg["cad"] else None,
                "power": round(seg["power"] * (1 + r.gauss(0, 0.06))) if seg["power"] else None,
                "stamina": max(20.0, 100 - t / dur * 62),
            })
        return {"rows": rows, "segments": segments, "step": step}

    def _segments(self, a: dict[str, Any]) -> list[dict[str, Any]]:
        kind = a["_kind"]
        r = _rng("seg", a["activityId"])
        avg_speed = a["averageSpeed"] or 0
        cad = a["averageRunningCadenceInStepsPerMinute"] or 0
        power = a["avgPower"] or 0
        hr = a["averageHR"]
        if kind == "hyrox":
            d = _d(a["startTimeLocal"])
            plan = self._hyrox_plan(d, int(str(a["activityId"])[-1]), a["_spec"].get("race", False))
            segs = []
            for i, p in enumerate(plan):
                run = p["kind"] == "run"
                segs.append({
                    "name": p["name"] if a["_spec"].get("named") else None,
                    "duration": p["duration"], "distance": p["distance"],
                    "speed": p["distance"] / p["duration"] if run else 0.0,
                    "hr": (164 + i * 0.6) if run else (172 + (6 if "Wall" in p["name"] or "Burpee" in p["name"] else 0)),
                    "cad": 166 if run else None, "power": None, "intensity": "ACTIVE",
                })
            return segs
        if kind == "intervals":
            segs = [{"name": "Warm up", "duration": 2000 / 3.0, "distance": 2000, "speed": 3.0, "hr": 138, "intensity": "WARMUP"}]
            for i in range(6):
                segs.append({"name": None, "duration": 800 / 4.65, "distance": 800, "speed": 4.65, "hr": 176 + i, "intensity": "ACTIVE"})
                segs.append({"name": None, "duration": 400 / 2.6, "distance": 400, "speed": 2.6, "hr": 146, "intensity": "REST"})
            segs.append({"name": "Cool down", "duration": 0.0, "distance": 0, "speed": 2.9, "hr": 140, "intensity": "COOLDOWN"})
            used = sum(s["duration"] for s in segs)
            segs[-1]["duration"] = max(240.0, a["duration"] - used)
            segs[-1]["distance"] = segs[-1]["duration"] * 2.9
            for s in segs:
                s["cad"] = 182 if s["speed"] > 4 else 170
                s["power"] = 340 if s["speed"] > 4 else 240
            return segs
        if kind == "strength":
            segs = []
            for i in range(18):
                segs.append({"name": None, "duration": 45 + r.uniform(-10, 20), "distance": 0, "speed": 0, "hr": 128 + r.uniform(0, 14), "cad": None, "power": None, "intensity": "ACTIVE"})
                segs.append({"name": None, "duration": 120 + r.uniform(-20, 40), "distance": 0, "speed": 0, "hr": 104, "cad": None, "power": None, "intensity": "REST"})
            scale = a["duration"] / sum(s["duration"] for s in segs)
            for s in segs:
                s["duration"] *= scale
            return segs
        if kind == "compromised":
            segs = []
            for i in range(5):
                segs.append({"name": None, "duration": 1000 / 3.7, "distance": 1000, "speed": 3.7, "hr": 166, "cad": 172, "power": None, "intensity": "ACTIVE"})
                segs.append({"name": None, "duration": 360, "distance": 0, "speed": 0, "hr": 158, "cad": None, "power": None, "intensity": "ACTIVE"})
            scale = a["duration"] / sum(s["duration"] for s in segs)
            for s in segs:
                s["duration"] *= scale
                s["speed"] = s["distance"] / s["duration"] if s["distance"] else 0
            return segs
        # Steady efforts: split by km (runs), 5 km (rides) or 100 m (swims).
        unit = 1000.0 if a["activityType"]["typeKey"] == "running" else 5000.0 if kind == "ride" else 100.0
        total = a["distance"] or 1000.0
        segs = []
        covered = 0.0
        i = 0
        while covered < total - 1:
            d = min(unit, total - covered)
            sp = avg_speed * (1 + r.gauss(0, 0.025) - (0.01 * i if kind == "long_run" else 0) + (0.004 * i if kind == "tempo" else 0))
            segs.append({"name": None, "duration": d / sp if sp else 60.0, "distance": d, "speed": sp,
                         "hr": hr - 8 + min(16.0, i * 1.6), "cad": cad or None, "power": power or None, "intensity": "ACTIVE"})
            covered += d
            i += 1
        scale = a["duration"] / sum(s["duration"] for s in segs)
        for s in segs:
            s["duration"] *= scale
            s["speed"] = s["distance"] / s["duration"] if s["duration"] else 0
        return segs

    def _route(self, a: dict[str, Any], n: int) -> list[tuple[float, float]]:
        r = _rng("route", a["activityId"])
        km = (a["distance"] or 5000) / 1000
        kind = a["_kind"]
        lat0, lon0 = CENTER
        lat0 += r.uniform(-0.02, 0.02)
        lon0 += r.uniform(-0.03, 0.03)
        if kind in ("intervals",):
            pts = []
            for i in range(n):  # 400 m track
                th = (i / n) * 2 * math.pi * (km / 0.4)
                x = 0.042 * math.cos(th) * (1.6 if math.cos(th) > 0 else 1.6)
                y = 0.06 * math.sin(th)
                pts.append((lat0 + y / 111, lon0 + x / (111 * math.cos(math.radians(lat0)))))
            return pts
        # A street-grid run: straight blocks with turns, heading home in the second half.
        grid = math.radians(r.uniform(8, 20))
        dirs = [(math.cos(grid + k * math.pi / 2), math.sin(grid + k * math.pi / 2)) for k in range(4)]
        x = y = 0.0
        heading = r.randrange(4)
        path = [(0.0, 0.0)]
        walked = 0.0
        total = km * 0.97
        while walked < total:
            left = total - walked
            seg = min(left, r.uniform(0.18, 0.75) * (2.2 if kind == "ride" else 1))
            if walked > total * 0.5:
                # choose the grid direction that most reduces distance to home
                best = min(range(4), key=lambda k: (x + dirs[k][0] * seg) ** 2 + (y + dirs[k][1] * seg) ** 2)
                heading = best if r.random() < 0.8 else heading
                dist_home = math.hypot(x, y)
                if dist_home < seg:
                    seg = dist_home
            else:
                turn = r.random()
                if turn < 0.35:
                    heading = (heading + 1) % 4
                elif turn < 0.7:
                    heading = (heading + 3) % 4
            steps = max(1, int(seg / 0.02))
            for _ in range(steps):
                x += dirs[heading][0] * seg / steps + r.gauss(0, 0.0015)
                y += dirs[heading][1] * seg / steps + r.gauss(0, 0.0015)
                path.append((x, y))
            walked += seg
            if seg <= 0.001:
                break
        path.append((0.0, 0.0))
        # resample to n points evenly
        cum = [0.0]
        for (x1, y1), (x2, y2) in zip(path, path[1:]):
            cum.append(cum[-1] + math.hypot(x2 - x1, y2 - y1))
        L = cum[-1] or 1
        pts = []
        j = 0
        for i in range(n):
            target = L * i / max(1, n - 1)
            while j < len(cum) - 2 and cum[j + 1] < target:
                j += 1
            span = (cum[j + 1] - cum[j]) or 1
            f = (target - cum[j]) / span
            px = path[j][0] + (path[j + 1][0] - path[j][0]) * f
            py = path[j][1] + (path[j + 1][1] - path[j][1]) * f
            pts.append((lat0 + py / 111, lon0 + px / (111 * math.cos(math.radians(lat0)))))
        return pts

    def get_activity_details(self, activity_id: Any, maxchart: int = 2000, maxpoly: int = 4000) -> dict[str, Any]:
        a = self._by_id[int(activity_id)]
        s = self._stream(int(activity_id))
        rows = s["rows"]
        keys = ["directTimestamp", "sumDuration", "sumDistance", "directHeartRate", "directSpeed",
                "directElevation", "directDoubleCadence", "directPower", "directAvailableStamina"]
        has_gps = a["hasPolyline"]
        if has_gps:
            keys += ["directLatitude", "directLongitude"]
            route = self._route(a, len(rows))
        descriptors = [{"metricsIndex": i, "key": k, "unit": {}} for i, k in enumerate(keys)]
        metrics = []
        for i, row in enumerate(rows):
            vals = [row["ts"], float(row["t"]), row["dist"], row["hr"], row["speed"], row["elev"],
                    row["cad"], row["power"], row["stamina"]]
            if has_gps:
                vals += [route[i][0], route[i][1]]
            metrics.append({"metrics": vals})
        poly = None
        if has_gps:
            pts = self._route(a, min(maxpoly, 900))
            poly = {"polyline": [{"lat": la, "lon": lo} for la, lo in pts],
                    "minLat": min(p[0] for p in pts), "maxLat": max(p[0] for p in pts),
                    "minLon": min(p[1] for p in pts), "maxLon": max(p[1] for p in pts)}
        return {"activityId": a["activityId"], "metricDescriptors": descriptors,
                "activityDetailMetrics": metrics, "geoPolylineDTO": poly,
                "measurementCount": len(keys), "metricsCount": len(metrics)}

    def get_activity_splits(self, activity_id: Any) -> dict[str, Any]:
        a = self._by_id[int(activity_id)]
        s = self._stream(int(activity_id))
        laps = []
        start = datetime.strptime(a["startTimeGMT"], "%Y-%m-%d %H:%M:%S")
        t0 = 0.0
        for i, seg in enumerate(s["segments"]):
            seg_rows = [row for row in s["rows"] if row["seg"] == i] or s["rows"][-1:]
            hrs = [row["hr"] for row in seg_rows]
            lap = {
                "lapIndex": i + 1,
                "startTimeGMT": _iso(start + timedelta(seconds=t0)),
                "distance": round(seg["distance"], 1), "duration": round(seg["duration"], 1),
                "movingDuration": round(seg["duration"], 1), "elapsedDuration": round(seg["duration"], 1),
                "averageSpeed": round(seg["speed"], 3), "maxSpeed": round(seg["speed"] * 1.15, 3),
                "averageHR": round(sum(hrs) / len(hrs)), "maxHR": max(hrs),
                "calories": round(seg["duration"] / 60 * 12),
                "averageRunCadence": seg.get("cad"), "averagePower": seg.get("power"),
                "elevationGain": round(seg["distance"] * 0.011, 1) if seg["distance"] else None,
                "intensityType": seg.get("intensity", "ACTIVE"),
            }
            if seg.get("name"):
                lap["lapName"] = seg["name"]
            laps.append(lap)
            t0 += seg["duration"]
        return {"activityId": a["activityId"], "lapDTOs": laps, "eventDTOs": []}

    def get_activity_hr_in_timezones(self, activity_id: Any) -> list[dict[str, Any]]:
        s = self._stream(int(activity_id))
        secs = [0.0] * 5
        for row in s["rows"]:
            z = sum(1 for low in HR_ZONE_LOWS if row["hr"] >= low)
            if z:
                secs[z - 1] += s["step"]
        return [{"zoneNumber": i + 1, "secsInZone": round(v, 1), "zoneLowBoundary": HR_ZONE_LOWS[i]} for i, v in enumerate(secs)]

    def get_activity_exercise_sets(self, activity_id: Any) -> dict[str, Any]:
        a = self._by_id[int(activity_id)]
        if a["_kind"] != "strength":
            return {"activityId": a["activityId"], "exerciseSets": None}
        r = _rng("sets", a["activityId"])
        plan = [("SQUAT", "BARBELL_BACK_SQUAT", 100000), ("DEADLIFT", "ROMANIAN_DEADLIFT", 90000),
                ("LUNGE", "WALKING_LUNGE", 24000), ("PULL_UP", "PULL_UP", 0),
                ("BENCH_PRESS", "BARBELL_BENCH_PRESS", 75000), ("PLANK", "PLANK", 0)]
        sets = []
        t = datetime.strptime(a["startTimeGMT"], "%Y-%m-%d %H:%M:%S")
        for cat, name, weight in plan:
            for _ in range(3):
                reps = int(r.uniform(6, 10)) if cat != "PLANK" else 0
                dur = r.uniform(30, 60)
                sets.append({"exercises": [{"category": cat, "name": name, "probability": 98.0}],
                             "duration": dur, "repetitionCount": reps, "weight": float(weight) if weight else None,
                             "setType": "ACTIVE", "startTime": _iso(t)})
                t += timedelta(seconds=dur)
                sets.append({"exercises": [], "duration": 120.0, "repetitionCount": None, "weight": None,
                             "setType": "REST", "startTime": _iso(t)})
                t += timedelta(seconds=120)
        return {"activityId": a["activityId"], "exerciseSets": sets}

    def get_activity_weather(self, activity_id: Any) -> dict[str, Any]:
        r = _rng("wx", activity_id)
        return {"temp": int(r.uniform(58, 76)), "apparentTemp": int(r.uniform(58, 76)),
                "relativeHumidity": int(r.uniform(35, 70)), "windSpeed": int(r.uniform(2, 14)),
                "windDirectionCompassPoint": r.choice(["n", "ne", "nw", "w", "e", "s"]),
                "weatherTypeDTO": {"desc": r.choice(["Sunny", "Partly Cloudy", "Mostly Clear", "Cloudy"])}}

    # ------------------------------------------------------------ daily wellness
    def get_user_summary(self, cdate: str) -> dict[str, Any]:
        day = _d(cdate)
        m = self._day(day)
        acts = self._activities_on(day)
        active_kcal = int(420 + sum(a["calories"] for a in acts) + m["steps"] * 0.02)
        is_today = day == self.today
        frac = 0.82 if is_today else 1.0
        bb_now = m["bb_low"] + 22 if is_today else m["bb_low"]
        return {
            "calendarDate": day.isoformat(),
            "totalSteps": int(m["steps"] * frac), "dailyStepGoal": 10000,
            "totalDistanceMeters": int(m["steps"] * frac * 0.78),
            "totalKilocalories": int((1810 + active_kcal) * frac) if is_today else 1810 + active_kcal,
            "activeKilocalories": int(active_kcal * frac), "bmrKilocalories": 1810,
            "minHeartRate": m["rhr"] - 4, "maxHeartRate": max([int(a["maxHR"]) for a in acts] + [128]),
            "restingHeartRate": m["rhr"], "lastSevenDaysAvgRestingHeartRate": 50,
            "averageStressLevel": m["stress"], "maxStressLevel": min(99, m["stress"] + 58),
            "restStressDuration": 26400, "lowStressDuration": 15600, "mediumStressDuration": 5700,
            "highStressDuration": 1500, "activityStressDuration": int(sum(a["duration"] for a in acts)),
            "bodyBatteryChargedValue": m["bb_high"] - 18, "bodyBatteryDrainedValue": m["bb_high"] - bb_now,
            "bodyBatteryHighestValue": m["bb_high"], "bodyBatteryLowestValue": m["bb_low"] if not is_today else bb_now,
            "bodyBatteryMostRecentValue": bb_now, "bodyBatteryAtWakeTime": m["bb_high"],
            "floorsAscended": 11.0, "floorsDescended": 9.0, "userFloorsAscendedGoal": 10,
            "moderateIntensityMinutes": m["moderate"],
            "vigorousIntensityMinutes": int(sum(a["vigorousIntensityMinutes"] for a in acts)),
            "intensityMinutesGoal": 150,
            "averageSpo2": m["spo2"], "lowestSpo2": m["spo2_low"], "latestSpo2": m["spo2"] + 1,
            "avgWakingRespirationValue": m["resp_wake"], "highestRespirationValue": 24.0,
            "lowestRespirationValue": 11.0, "latestRespirationValue": m["resp_wake"],
            "sleepingSeconds": m["sleep_s"], "activeSeconds": 9800, "highlyActiveSeconds": 4100,
            "sedentarySeconds": 40100,
        }

    def get_stats(self, cdate: str) -> dict[str, Any]:
        return self.get_user_summary(cdate)

    def _timeline(self, day: date, every_min: int) -> list[datetime]:
        start = datetime.combine(day, datetime.min.time())
        end = start + timedelta(days=1)
        if day == self.today:
            end = start + timedelta(hours=15, minutes=40)
        out = []
        t = start
        while t < end:
            out.append(t)
            t += timedelta(minutes=every_min)
        return out

    def _asleep(self, day: date, t: datetime) -> bool:
        m = self._day(day)
        wake = datetime.combine(day, datetime.min.time()) + timedelta(minutes=(m["bed_min"] - 1440) % 1440) + timedelta(seconds=m["sleep_s"] + m["awake"])
        prev = self._day(day - timedelta(days=1))
        bed = datetime.combine(day - timedelta(days=1), datetime.min.time()) + timedelta(minutes=prev["bed_min"])
        bed_today = datetime.combine(day, datetime.min.time()) + timedelta(minutes=m["bed_min"])
        sleep_end = bed + timedelta(seconds=m["sleep_s"] + m["awake"])
        return bed <= t < sleep_end or t >= bed_today or wake is None

    def _active_at(self, day: date, t: datetime) -> dict[str, Any] | None:
        for a in self._activities_on(day):
            start = datetime.strptime(a["startTimeLocal"], "%Y-%m-%d %H:%M:%S")
            if start <= t < start + timedelta(seconds=a["duration"]):
                return a
        return None

    def get_heart_rates(self, cdate: str) -> dict[str, Any]:
        day = _d(cdate)
        m = self._day(day)
        r = _rng("hr", day.isoformat())
        values = []
        for t in self._timeline(day, 2):
            act = self._active_at(day, t)
            if act:
                v = act["averageHR"] + r.gauss(0, 8)
            elif self._asleep(day, t):
                v = m["rhr"] + 2 + r.gauss(0, 2)
            else:
                v = m["rhr"] + 22 + 10 * math.sin(t.hour / 3) + r.gauss(0, 6)
            values.append([_ms(_gmt(t)), int(v)])
        return {"calendarDate": day.isoformat(), "restingHeartRate": m["rhr"],
                "minHeartRate": m["rhr"] - 4, "maxHeartRate": max(v for _, v in values),
                "lastSevenDaysAvgRestingHeartRate": 50, "heartRateValues": values}

    def _bb_curve(self, day: date) -> list[list[Any]]:
        m = self._day(day)
        r = _rng("bb", day.isoformat())
        level = float(m["bb_low"] + 8)
        out = []
        for t in self._timeline(day, 3):
            act = self._active_at(day, t)
            if self._asleep(day, t) and t.hour < 12:
                level += (m["bb_high"] - level) * 0.035
            elif act:
                level -= 0.55
            else:
                level -= 0.17 + r.uniform(0, 0.08)
            level = max(5, min(100, level))
            out.append([_ms(_gmt(t)), int(round(level))])
        return out

    def get_stress_data(self, cdate: str) -> dict[str, Any]:
        day = _d(cdate)
        m = self._day(day)
        r = _rng("stress", day.isoformat())
        values = []
        for t in self._timeline(day, 3):
            if self._active_at(day, t):
                v = -2
            elif self._asleep(day, t):
                v = int(max(0, r.gauss(12, 5)))
            else:
                v = int(max(0, min(99, m["stress"] + 14 * math.sin(t.hour / 2.4) + r.gauss(4, 11))))
            values.append([_ms(_gmt(t)), v])
        bb = [[ts, "MEASURED", lvl, 2.0] for ts, lvl in self._bb_curve(day)]
        return {"calendarDate": day.isoformat(), "avgStressLevel": m["stress"],
                "maxStressLevel": max(v for _, v in values), "stressValuesArray": values,
                "bodyBatteryValuesArray": bb}

    def get_all_day_stress(self, cdate: str) -> dict[str, Any]:
        return self.get_stress_data(cdate)

    def get_body_battery(self, startdate: str, enddate: str | None = None) -> list[dict[str, Any]]:
        s, e = _d(startdate), _d(enddate or startdate)
        out = []
        d = s
        while d <= e:
            m = self._day(d)
            out.append({"date": d.isoformat(), "charged": m["bb_high"] - 18, "drained": m["bb_high"] - m["bb_low"],
                        "bodyBatteryValuesArray": self._bb_curve(d)})
            d += timedelta(days=1)
        return out

    def get_body_battery_events(self, cdate: str) -> list[dict[str, Any]]:
        day = _d(cdate)
        m = self._day(day)
        prev = self._day(day - timedelta(days=1))
        bed = datetime.combine(day - timedelta(days=1), datetime.min.time()) + timedelta(minutes=prev["bed_min"])
        events = [{"event": {"eventType": "SLEEP", "eventStartTimeGmt": _iso(_gmt(bed)),
                             "durationInMilliseconds": m["sleep_s"] * 1000,
                             "bodyBatteryImpact": m["bb_high"] - m["bb_low"] - 4,
                             "feedbackType": "SLEEP_RESTFUL", "shortFeedback": "RESTFUL_PERIOD"}}]
        for a in self._activities_on(day):
            start = datetime.strptime(a["startTimeLocal"], "%Y-%m-%d %H:%M:%S")
            events.append({"event": {"eventType": "ACTIVITY", "eventStartTimeGmt": _iso(_gmt(start)),
                                     "durationInMilliseconds": int(a["duration"] * 1000),
                                     "bodyBatteryImpact": a["differenceBodyBattery"],
                                     "feedbackType": "EXERCISE_TRAINING", "shortFeedback": "VERY_TIRING"},
                           "activityName": a["activityName"], "activityType": a["activityType"]["typeKey"]})
        return events

    def get_sleep_data(self, cdate: str) -> dict[str, Any]:
        day = _d(cdate)
        m = self._day(day)
        prev = self._day(day - timedelta(days=1))
        r = _rng("sleep", day.isoformat())
        bed_local = datetime.combine(day - timedelta(days=1), datetime.min.time()) + timedelta(minutes=prev["bed_min"])
        total = m["sleep_s"] + m["awake"]
        # Build ~90-minute cycles: light -> deep -> light -> rem, deep front-loaded.
        levels = []
        t = bed_local
        end = bed_local + timedelta(seconds=total)
        cycle = 0
        budget = {"deep": m["deep"], "rem": m["rem"], "awake": m["awake"]}
        while t < end:
            share_deep = max(0.0, 0.42 - cycle * 0.1)
            plan = [(1, 18 * 60), (0, budget["deep"] * share_deep), (1, 22 * 60), (2, budget["rem"] / 5 * (0.6 + cycle * 0.2))]
            if r.random() < 0.45:
                plan.append((3, r.uniform(1, 5) * 60))
            for lvl, secs in plan:
                if t >= end or secs <= 30:
                    continue
                stop = min(end, t + timedelta(seconds=secs))
                levels.append({"startGMT": _iso(_gmt(t)), "endGMT": _iso(_gmt(stop)), "activityLevel": float(lvl)})
                t = stop
            cycle += 1
        overall = {"value": m["score"], "qualifierKey": "EXCELLENT" if m["score"] >= 90 else "GOOD" if m["score"] >= 80 else "FAIR" if m["score"] >= 60 else "POOR"}
        return {
            "dailySleepDTO": {
                "calendarDate": day.isoformat(), "sleepTimeSeconds": m["sleep_s"], "napTimeSeconds": 0,
                "deepSleepSeconds": m["deep"], "lightSleepSeconds": m["light"], "remSleepSeconds": m["rem"],
                "awakeSleepSeconds": m["awake"],
                "sleepStartTimestampGMT": _ms(_gmt(bed_local)), "sleepEndTimestampGMT": _ms(_gmt(end)),
                "sleepStartTimestampLocal": _ms(bed_local), "sleepEndTimestampLocal": _ms(end),
                "avgSleepStress": 11.0, "averageSpO2Value": m["spo2"], "lowestSpO2Value": m["spo2_low"],
                "averageRespirationValue": m["resp_sleep"], "lowestRespirationValue": 11.0, "highestRespirationValue": 17.0,
                "awakeCount": 2, "restlessMomentsCount": int(r.uniform(18, 46)),
                "sleepScores": {"overall": overall,
                                "totalDuration": {"qualifierKey": "GOOD" if m["sleep_s"] > 25200 else "FAIR"},
                                "deepPercentage": {"value": round(m["deep"] / m["sleep_s"] * 100), "qualifierKey": "GOOD"},
                                "remPercentage": {"value": round(m["rem"] / m["sleep_s"] * 100), "qualifierKey": "GOOD"},
                                "lightPercentage": {"value": round(m["light"] / m["sleep_s"] * 100), "qualifierKey": "GOOD"},
                                "stress": {"qualifierKey": "EXCELLENT"}, "restlessness": {"qualifierKey": "GOOD"},
                                "awakeCount": {"qualifierKey": "GOOD"}},
                "sleepScoreFeedback": "POSITIVE_DEEP_AND_REM" if m["score"] >= 80 else "NEGATIVE_SHORT_BUT_RESTFUL",
                "sleepScoreInsight": "POSITIVE_RESTFUL_DAY",
                "sleepNeed": {"baseline": 470, "actual": 480 + int(m["fatigue"] * 40), "feedback": "INCREASED_TRAINING"},
                "avgOvernightHrv": m["hrv"], "hrvStatus": "BALANCED", "bodyBatteryChange": m["bb_high"] - m["bb_low"] - 4,
                "restingHeartRate": m["rhr"],
            },
            "sleepLevels": levels,
            "restingHeartRate": m["rhr"], "avgOvernightHrv": m["hrv"],
            "bodyBatteryChange": m["bb_high"] - m["bb_low"] - 4,
            "wellnessSpO2SleepSummaryDTO": {"averageSPO2": m["spo2"], "lowestSPO2": m["spo2_low"]},
        }

    def get_hrv_data(self, cdate: str) -> dict[str, Any]:
        day = _d(cdate)
        m = self._day(day)
        week = [self._day(day - timedelta(days=i))["hrv"] for i in range(7)]
        weekly = round(sum(week) / 7)
        base = self._hrv_baseline()
        status = "BALANCED" if base["balancedLow"] <= weekly <= base["balancedUpper"] else "UNBALANCED" if weekly > base["lowUpper"] else "LOW"
        r = _rng("hrvread", day.isoformat())
        sleep = self.get_sleep_data(cdate)["dailySleepDTO"]
        t = datetime.fromtimestamp(sleep["sleepStartTimestampGMT"] / 1000, tz=timezone.utc).replace(tzinfo=None)
        readings = []
        while _ms(t) < sleep["sleepEndTimestampGMT"]:
            readings.append({"hrvValue": int(m["hrv"] + r.gauss(0, 9)), "readingTimeGMT": _iso(t), "readingTimeLocal": _iso(t + TZ_OFFSET)})
            t += timedelta(minutes=5)
        return {"hrvSummary": {"calendarDate": day.isoformat(), "weeklyAvg": weekly, "lastNightAvg": m["hrv"],
                               "lastNight5MinHigh": m["hrv"] + 24, "baseline": base, "status": status,
                               "feedbackPhrase": f"HRV_{status}_1"},
                "hrvReadings": readings}

    def get_hrv_data_range(self, start: str, end: str) -> dict[str, Any]:
        s, e = _d(start), _d(end)
        out = []
        d = s
        while d <= e:
            m = self._day(d)
            week = [self._day(d - timedelta(days=i))["hrv"] for i in range(7)]
            out.append({"calendarDate": d.isoformat(), "weeklyAvg": round(sum(week) / 7), "lastNightAvg": m["hrv"],
                        "baseline": self._hrv_baseline(), "status": "BALANCED"})
            d += timedelta(days=1)
        return {"hrvSummaries": out}

    def get_training_readiness(self, cdate: str) -> list[dict[str, Any]]:
        day = _d(cdate)
        m = self._day(day)
        score = m["readiness"]
        level = "PRIME" if score >= 95 else "HIGH" if score >= 75 else "MODERATE" if score >= 50 else "LOW" if score >= 25 else "POOR"
        rec = int(m["fatigue"] * 1900)
        return [{
            "calendarDate": day.isoformat(), "timestamp": f"{day.isoformat()}T05:02:00.0",
            "timestampLocal": f"{day.isoformat()}T07:02:00.0",
            "score": score, "level": level,
            "feedbackShort": "WELL_RECOVERED" if score >= 70 else "RECOVERING_TAKE_IT_EASY",
            "feedbackLong": "WELL_RECOVERED_READY_HARD_TRAINING" if score >= 70 else "RECOVERING_LIGHT_TRAINING",
            "sleepScore": m["score"], "sleepScoreFactorPercent": min(100, m["score"]),
            "sleepScoreFactorFeedback": "GOOD" if m["score"] >= 75 else "MODERATE",
            "recoveryTime": rec, "recoveryTimeFactorPercent": max(5, 100 - rec // 30),
            "recoveryTimeFactorFeedback": "GOOD" if rec < 900 else "MODERATE",
            "acwrFactorPercent": int(88 - m["fatigue"] * 30), "acwrFactorFeedback": "GOOD",
            "hrvFactorPercent": max(10, min(100, int((m["hrv"] - 50) * 2.5))), "hrvFactorFeedback": "GOOD",
            "stressHistoryFactorPercent": 82, "stressHistoryFactorFeedback": "GOOD",
            "sleepHistoryFactorPercent": 76, "sleepHistoryFactorFeedback": "GOOD",
            "inputContext": "AFTER_WAKEUP_RESET",
        }]

    def get_training_readiness_range(self, start: str, end: str) -> list[dict[str, Any]]:
        out = []
        d, e = _d(start), _d(end)
        while d <= e:
            out += self.get_training_readiness(d.isoformat())
            d += timedelta(days=1)
        return out

    def _acute_chronic(self, day: date) -> tuple[float, float]:
        acute = sum(self._load(day - timedelta(days=i)) * math.exp(-i / 4) for i in range(14)) / 3.2
        chronic = sum(self._load(day - timedelta(days=i)) * math.exp(-i / 18) for i in range(56)) / 15.5
        return acute, chronic

    def get_training_status(self, cdate: str) -> dict[str, Any]:
        day = _d(cdate)
        m = self._day(day)
        acute, chronic = self._acute_chronic(day)
        ratio = acute / chronic if chronic else 1
        dev = "3442975544"
        month = [a for a in self._activities if 0 <= (day - _d(a["startTimeLocal"])).days < 28]
        low = sum(a["activityTrainingLoad"] * 0.55 for a in month if a["aerobicTrainingEffect"] < 3.5)
        high = sum(a["activityTrainingLoad"] * 0.7 for a in month if a["aerobicTrainingEffect"] >= 3.5)
        ana = sum(a["activityTrainingLoad"] * a["anaerobicTrainingEffect"] / 10 for a in month)
        phrase = "PRODUCTIVE_1" if 0.9 <= ratio <= 1.3 else "MAINTAINING_2" if ratio < 0.9 else "PEAKING_1"
        return {
            "mostRecentVO2Max": {"generic": {"calendarDate": day.isoformat(), "vo2MaxPreciseValue": m["vo2"],
                                             "vo2MaxValue": round(m["vo2"]), "fitnessAge": 21},
                                 "cycling": {"calendarDate": day.isoformat(), "vo2MaxPreciseValue": 52.4, "vo2MaxValue": 52},
                                 "heatAltitudeAcclimation": {"calendarDate": day.isoformat(), "altitudeAcclimation": 1340,
                                                             "heatAcclimationPercentage": 38, "currentAltitude": 1339,
                                                             "heatTrend": "ACCLIMATIZING", "altitudeTrend": "ACCLIMATIZED"}},
            "mostRecentTrainingLoadBalance": {"metricsTrainingLoadBalanceDTOMap": {dev: {
                "calendarDate": day.isoformat(), "monthlyLoadAerobicLow": round(low), "monthlyLoadAerobicHigh": round(high),
                "monthlyLoadAnaerobic": round(ana),
                "monthlyLoadAerobicLowTargetMin": 380, "monthlyLoadAerobicLowTargetMax": 820,
                "monthlyLoadAerobicHighTargetMin": 420, "monthlyLoadAerobicHighTargetMax": 840,
                "monthlyLoadAnaerobicTargetMin": 110, "monthlyLoadAnaerobicTargetMax": 330,
                "trainingBalanceFeedbackPhrase": "BALANCED" if low >= 380 else "AEROBIC_LOW_SHORTAGE",
                "primaryTrainingDevice": True}}},
            "mostRecentTrainingStatus": {"latestTrainingStatusData": {dev: {
                "calendarDate": day.isoformat(), "trainingStatus": 7, "trainingStatusFeedbackPhrase": phrase,
                "fitnessTrend": 2, "primaryTrainingDevice": True,
                "acuteTrainingLoadDTO": {"acwrPercent": int(ratio * 50), "acwrStatus": "OPTIMAL" if ratio <= 1.4 else "HIGH",
                                         "acwrStatusFeedback": "FEEDBACK_2", "dailyTrainingLoadAcute": round(acute),
                                         "dailyTrainingLoadChronic": round(chronic), "maxTrainingLoadChronic": round(chronic * 1.5),
                                         "minTrainingLoadChronic": round(chronic * 0.8),
                                         "dailyAcuteChronicWorkloadRatio": round(ratio, 2)}}}},
        }

    def get_max_metrics(self, cdate: str) -> list[dict[str, Any]]:
        return [self.get_training_status(cdate)["mostRecentVO2Max"]]

    def get_max_metrics_range(self, start: str, end: str, aggregation: str = "daily", sport: str | None = None) -> list[dict[str, Any]]:
        out = []
        d, e = _d(start), _d(end)
        while d <= e:
            if d.weekday() in (0, 2, 5):
                out.append({"generic": {"calendarDate": d.isoformat(), "vo2MaxPreciseValue": self._day(d)["vo2"]}})
            d += timedelta(days=1)
        return out

    def get_race_predictions(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
        vo2 = self._day(self.today)["vo2"]
        f = 56.2 / vo2
        return {"calendarDate": self.today.isoformat(), "time5K": int(1182 * f), "time10K": int(2478 * f),
                "timeHalfMarathon": int(5520 * f), "timeMarathon": int(11820 * f)}

    def get_endurance_score(self, startdate: str, enddate: str | None = None, aggregation: str = "weekly") -> dict[str, Any]:
        return {"calendarDate": startdate, "overallScore": 7246, "classification": 4,
                "feedbackPhrase": 34, "gaugeLowerLimit": 3570, "classificationLowerLimitIntermediate": 5185,
                "classificationLowerLimitTrained": 6014, "classificationLowerLimitWellTrained": 6843,
                "classificationLowerLimitExpert": 7672, "classificationLowerLimitSuperior": 8501,
                "classificationLowerLimitElite": 9330, "gaugeUpperLimit": 10159,
                "contributors": [{"activityTypeId": 1, "group": None, "contribution": 61.2},
                                 {"activityTypeId": None, "group": 2, "contribution": 22.5},
                                 {"activityTypeId": 2, "group": None, "contribution": 16.3}]}

    def get_hill_score(self, startdate: str, enddate: str | None = None) -> dict[str, Any]:
        return {"calendarDate": startdate, "strengthScore": 46, "enduranceScore": 58, "overallScore": 61,
                "hillScoreClassificationId": 3, "hillScoreFeedbackPhraseId": 12, "vo2MaxPreciseValue": 56.0}

    def get_lactate_threshold(self, **kwargs: Any) -> dict[str, Any]:
        return {"speed_and_heart_rate": {"userProfilePK": 1, "calendarDate": self.today.isoformat(),
                                         "speed": 0.3448, "heartRate": 172, "heartRateCycling": None},
                "power": {"functionalThresholdPower": 318, "weight": 78.0, "powerToWeight": 4.08}}

    def get_fitnessage_data(self, cdate: str) -> dict[str, Any]:
        return {"chronologicalAge": 21, "fitnessAge": 17.4, "achievableFitnessAge": 16.0,
                "components": {"vigorousDaysAvg": {"value": 4.6}, "rhr": {"value": 49}, "bmi": {"value": 23.8},
                               "vigorousMinutesAvg": {"value": 236}}}

    def get_respiration_data(self, cdate: str) -> dict[str, Any]:
        day = _d(cdate)
        m = self._day(day)
        r = _rng("resp", day.isoformat())
        vals = []
        for t in self._timeline(day, 4):
            act = self._active_at(day, t)
            base = 30 if act else m["resp_sleep"] if self._asleep(day, t) else m["resp_wake"]
            vals.append([_ms(_gmt(t)), round(base + r.gauss(0, 0.9), 1)])
        return {"calendarDate": day.isoformat(), "avgWakingRespirationValue": m["resp_wake"],
                "avgSleepRespirationValue": m["resp_sleep"], "highestRespirationValue": 24.0,
                "lowestRespirationValue": 11.0, "respirationValuesArray": vals}

    def get_spo2_data(self, cdate: str) -> dict[str, Any]:
        day = _d(cdate)
        m = self._day(day)
        r = _rng("spo2", day.isoformat())
        sleep = self.get_sleep_data(cdate)["dailySleepDTO"]
        hourly = []
        t = sleep["sleepStartTimestampGMT"]
        while t < sleep["sleepEndTimestampGMT"]:
            hourly.append([t, int(m["spo2"] + r.gauss(0, 1.2))])
            t += 3600 * 1000
        return {"calendarDate": day.isoformat(), "averageSpO2": m["spo2"], "lowestSpO2": m["spo2_low"],
                "latestSpO2": m["spo2"] + 1, "avgSleepSpO2": m["spo2"], "spO2HourlyAverages": hourly}

    def get_hydration_data(self, cdate: str) -> dict[str, Any]:
        r = _rng("water", cdate)
        return {"calendarDate": str(cdate)[:10], "valueInML": float(int(r.uniform(1200, 2900) / 250) * 250),
                "goalInML": 3200.0, "sweatLossInML": float(int(r.uniform(350, 1100)))}

    def get_body_composition(self, startdate: str, enddate: str | None = None) -> dict[str, Any]:
        s, e = _d(startdate), _d(enddate or startdate)
        items = []
        d = s
        while d <= e:
            if d.weekday() == 6:
                r = _rng("wt", d.isoformat())
                kg = 78.4 - (self.today - d).days * 0.004 + r.gauss(0, 0.35)
                items.append({"calendarDate": d.isoformat(), "date": _ms(datetime.combine(d, datetime.min.time()) + timedelta(hours=7)),
                              "weight": round(kg * 1000), "bmi": round(kg / 1.81 ** 2, 1),
                              "bodyFat": round(12.8 + r.gauss(0, 0.4), 1), "muscleMass": round(kg * 0.47 * 1000)})
            d += timedelta(days=1)
        return {"dateWeightList": list(reversed(items)), "totalAverage": {"weight": items[-1]["weight"] if items else None}}

    def get_daily_last_weight(self, start: str, end: str) -> list[dict[str, Any]]:
        return list(reversed(self.get_body_composition(start, end)["dateWeightList"]))

    # ------------------------------------------------------------ ranges
    def _each(self, start: str, end: str):
        d, e = _d(start), _d(end)
        while d <= e:
            yield d
            d += timedelta(days=1)

    def get_daily_steps(self, start: str, end: str) -> list[dict[str, Any]]:
        return [{"calendarDate": d.isoformat(), "totalSteps": self._day(d)["steps"], "stepGoal": 10000,
                 "totalDistance": self._day(d)["steps"] * 0.78} for d in self._each(start, end)]

    def get_sleep_daily(self, start: str, end: str) -> list[dict[str, Any]]:
        out = []
        for d in self._each(start, end):
            m = self._day(d)
            out.append({"calendarDate": d.isoformat(), "values": {
                "totalSleepTimeInSeconds": m["sleep_s"], "deepTime": m["deep"], "lightTime": m["light"],
                "remTime": m["rem"], "awakeTime": m["awake"], "sleepScore": m["score"],
                "sleepScoreQuality": "GOOD", "restingHeartRate": m["rhr"], "avgOvernightHrv": m["hrv"],
                "respiration": m["resp_sleep"], "spO2": m["spo2"]}})
        return out

    def get_rhr_daily(self, start: str, end: str) -> list[dict[str, Any]]:
        return [{"calendarDate": d.isoformat(), "value": self._day(d)["rhr"]} for d in self._each(start, end)]

    def get_daily_stress_stats(self, start: str, end: str) -> list[dict[str, Any]]:
        return [{"calendarDate": d.isoformat(), "values": {"overallStressLevel": self._day(d)["stress"]}} for d in self._each(start, end)]

    def get_daily_body_battery_stats(self, start: str, end: str) -> list[dict[str, Any]]:
        return [{"calendarDate": d.isoformat(), "values": {"highBB": self._day(d)["bb_high"], "lowBB": self._day(d)["bb_low"]}} for d in self._each(start, end)]

    def get_daily_intensity_minutes_stats(self, start: str, end: str) -> list[dict[str, Any]]:
        out = []
        for d in self._each(start, end):
            acts = self._activities_on(d)
            out.append({"calendarDate": d.isoformat(), "values": {
                "moderateValue": self._day(d)["moderate"], "vigorousValue": int(sum(a["vigorousIntensityMinutes"] for a in acts))},
                "weeklyGoal": 150})
        return out

    def get_daily_respiration_stats(self, start: str, end: str) -> list[dict[str, Any]]:
        return [{"calendarDate": d.isoformat(), "values": {"avgWakingRespirationValue": self._day(d)["resp_wake"],
                                                            "avgSleepRespirationValue": self._day(d)["resp_sleep"]}} for d in self._each(start, end)]

    def get_calories_daily(self, start: str, end: str) -> list[dict[str, Any]]:
        return [{"calendarDate": d.isoformat(), "activeKilocalories": self.get_user_summary(d.isoformat())["activeKilocalories"],
                 "totalKilocalories": self.get_user_summary(d.isoformat())["totalKilocalories"]} for d in self._each(start, end)]

    # ------------------------------------------------------------ plans, records, gear
    def get_next_scheduled_workout(self) -> dict[str, Any]:
        d = self.today + timedelta(days=1)
        return {"itemType": "workout", "date": d.isoformat(), "title": "Threshold 4 × 2 km",
                "sportTypeKey": "running", "workoutId": 912345, "duration": 3600, "distance": 12000.0,
                "description": "2 km warm up, 4 × 2 km @ 4:05/km with 2 min jog, cool down"}

    def get_personal_record(self, *args: Any, **kwargs: Any) -> list[dict[str, Any]]:
        t = self.today
        return [
            {"typeId": 1, "activityType": "running", "value": 196.4, "prStartTimeGmtFormatted": (t - timedelta(days=61)).isoformat() + "T04:12:00.0", "activityId": 1, "activityName": "6 × 800 m"},
            {"typeId": 3, "activityType": "running", "value": 1149.0, "prStartTimeGmtFormatted": (t - timedelta(days=96)).isoformat() + "T05:00:00.0", "activityId": 2, "activityName": "Parkrun"},
            {"typeId": 4, "activityType": "running", "value": 2421.0, "prStartTimeGmtFormatted": (t - timedelta(days=140)).isoformat() + "T05:00:00.0", "activityId": 3, "activityName": "Tempo Run"},
            {"typeId": 5, "activityType": "running", "value": 5512.0, "prStartTimeGmtFormatted": (t - timedelta(days=210)).isoformat() + "T04:30:00.0", "activityId": 4, "activityName": "Half marathon"},
            {"typeId": 7, "activityType": "running", "value": 24120.0, "prStartTimeGmtFormatted": (t - timedelta(days=180)).isoformat() + "T04:30:00.0", "activityId": 5, "activityName": "Long Run"},
            {"typeId": 8, "activityType": "cycling", "value": 62000.0, "prStartTimeGmtFormatted": (t - timedelta(days=24)).isoformat() + "T05:00:00.0", "activityId": 6, "activityName": "Sunday Ride"},
        ]

    def get_earned_badges(self) -> list[dict[str, Any]]:
        t = self.today
        names = ["Marathon Month", "Early Bird", "Step It Up", "Strength Streak", "Weekend Warrior", "1,000 km Runner", "Hydration Hero", "Sleep Ace"]
        return [{"badgeId": i + 1, "badgeName": n, "badgeEarnedDate": (t - timedelta(days=6 + i * 19)).isoformat() + "T08:00:00.0",
                 "badgePoints": [4, 2, 1, 2, 2, 8, 1, 2][i], "badgeCategoryId": 1} for i, n in enumerate(names)]

    def get_gear_list(self, *args: Any, **kwargs: Any) -> list[dict[str, Any]]:
        return [
            {"uuid": "g-1", "displayName": "Daily trainers", "gearMakeName": "Running shoe", "gearTypeName": "Shoes",
             "gearStatusName": "active", "maximumMeters": 700000.0, "totalDistance": 512300.0, "totalActivities": 74, "dateBegin": "2026-03-02T00:00:00.0"},
            {"uuid": "g-2", "displayName": "Race flats", "gearMakeName": "Racing shoe", "gearTypeName": "Shoes",
             "gearStatusName": "active", "maximumMeters": 500000.0, "totalDistance": 118400.0, "totalActivities": 21, "dateBegin": "2026-06-14T00:00:00.0"},
            {"uuid": "g-3", "displayName": "Road bike", "gearMakeName": "Bike", "gearTypeName": "Bike",
             "gearStatusName": "active", "maximumMeters": None, "totalDistance": 1830000.0, "totalActivities": 38, "dateBegin": "2025-11-01T00:00:00.0"},
        ]

    def get_devices(self) -> list[dict[str, Any]]:
        return [{"deviceId": 3442975544, "productDisplayName": "Forerunner 955", "deviceStatus": "active",
                 "currentFirmwareVersion": "23.14", "primaryActivityTrackerIndicator": True}]

    def get_device_last_used(self) -> dict[str, Any]:
        return {"userDeviceId": 3442975544, "lastUsedDeviceName": "Forerunner 955",
                "lastUsedDeviceUploadTime": _ms(_gmt(datetime.combine(self.today, datetime.min.time()) + timedelta(hours=15, minutes=32)))}

    def get_lifetime_totals(self) -> dict[str, Any]:
        return {"totalActivities": len(self._activities), "totalDistance": sum(a["distance"] or 0 for a in self._activities),
                "totalDuration": sum(a["duration"] for a in self._activities), "totalCalories": sum(a["calories"] for a in self._activities),
                "totalSteps": 4_210_000, "totalActiveDays": 311}
