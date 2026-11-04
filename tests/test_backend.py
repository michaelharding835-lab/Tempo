"""Backend tests. Run with:  GARMIN_FAKE=1 APP_ACCESS_KEY=test python -m pytest -q"""

from __future__ import annotations

import json
import os

os.environ.setdefault("GARMIN_FAKE", "1")
os.environ.setdefault("APP_ACCESS_KEY", "test")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from backend import hyrox, normalize as n, service, tools  # noqa: E402

AUTH = {"Authorization": "Bearer test"}


@pytest.fixture(scope="module")
def client():
    from app import app

    with TestClient(app) as c:
        yield c


# ---------------------------------------------------------------- HYROX detection


def _laps(names, run_secs=280, station_secs=260):
    out = []
    for i, name in enumerate(names):
        run = name.lower().startswith("run") or name == ""
        out.append({"index": i + 1, "name": name or None, "duration_s": run_secs if run else station_secs,
                    "distance_m": 1000 if run else 0, "avg_hr": 165})
    return out


def test_named_hyrox_laps_are_recognised():
    names = []
    for i, st in enumerate(hyrox.STATIONS):
        names += [f"Run {i + 1}", st]
    result = hyrox.analyse(_laps(names))
    assert result and result["complete"]
    assert [s["name"] for s in result["stations"]] == hyrox.STATIONS
    assert result["source"] == "named laps"


def test_unnamed_alternating_laps_follow_race_order():
    laps = []
    for i in range(8):
        laps.append({"index": 2 * i + 1, "name": None, "duration_s": 270 + i * 4, "distance_m": 1000})
        laps.append({"index": 2 * i + 2, "name": None, "duration_s": 250, "distance_m": 15})
    result = hyrox.analyse(laps, require_pattern=True)
    assert result["stations"][0]["name"] == "SkiErg" and result["stations"][-1]["name"] == "Wall Balls"
    assert result["compromised"]["decay_pct"] > 0


def test_ordinary_run_is_not_hyrox():
    laps = [{"index": i, "name": None, "duration_s": 300, "distance_m": 1000} for i in range(10)]
    assert hyrox.analyse(laps, require_pattern=True) is None


def test_strength_session_is_not_hyrox():
    laps = [{"index": i, "name": None, "duration_s": 60 if i % 2 else 120, "distance_m": 0} for i in range(30)]
    assert hyrox.analyse(laps, require_pattern=True) is None


# ---------------------------------------------------------------- normalisers survive missing data


@pytest.mark.parametrize("fn", [n.sleep, n.hrv, n.readiness, n.training_status, n.race_predictions,
                                n.endurance_score, n.hill_score, n.hydration, n.next_workout])
def test_normalisers_handle_empty_input(fn):
    for bad in (None, {}, [], "nope"):
        fn(bad)  # must not raise


def test_activity_summary_minimal():
    s = n.activity_summary({"activityId": 1, "activityType": {"typeKey": "treadmill_running"}, "duration": 1800,
                            "distance": 5000, "averageSpeed": 2.78})
    assert s["group"] == "run" and round(s["avg_pace_s_km"]) == 360


def test_hyrox_name_detection():
    s = n.activity_summary({"activityId": 2, "activityName": "HYROX Cape Town", "activityType": {"typeKey": "indoor_cardio"}})
    assert s["is_hyrox"] and s["group"] == "hyrox"


def test_range_series_picks_nested_values():
    rows = [{"calendarDate": "2026-01-01", "values": {"overallStressLevel": 30}},
            {"calendarDate": "2026-01-02", "values": {"averageStressLevel": 25}}]
    assert [p["value"] for p in n.range_series(rows, ["overallStressLevel", "averageStressLevel"])] == [30, 25]


def test_weight_grams_become_kg():
    assert n.weight_entries([{"calendarDate": "2026-01-01", "weight": 78400}])[0]["kg"] == 78.4


# ---------------------------------------------------------------- service bundles on sample data


def test_today_bundle_complete():
    d = service.today()
    for key in ("readiness", "sleep", "hrv", "body_battery", "stress", "heart_rate", "training", "week"):
        assert d[key], key
    assert d["hyrox_recent"]["hyrox"]["complete"]
    assert not d["missing"]


def test_activity_detail_has_streams_and_laps():
    acts = service.activities(0, 5)["items"]
    run = next(a for a in acts if a["group"] == "run")
    d = service.activity(run["id"])
    assert d["route"] and d["streams"]["hr"] and d["laps"] and d["hr_zones"]


@pytest.mark.parametrize("metric", list(service.TRENDS) + ["training_load", "run_distance"])
def test_every_trend_returns_points(metric):
    t = service.trends(metric, 28)
    assert t["points"], metric


def test_hyrox_history_finds_named_and_unnamed():
    h = service.hyrox_history()
    sources = {s["hyrox"]["source"] for s in h["sessions"]}
    assert {"named laps", "lap pattern"} <= sources


# ---------------------------------------------------------------- HTTP API and MCP


def test_requires_key(client):
    assert client.get("/api/today").status_code == 401
    assert client.get("/api/today", headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert client.get("/api/today", headers=AUTH).status_code == 200


def test_health_is_public(client):
    assert client.get("/api/health").json()["ok"] is True


@pytest.mark.parametrize("path", ["/api/check", "/api/activities?limit=5", "/api/training", "/api/trends/hrv?days=14",
                                  "/api/calendar", "/api/hyrox", "/api/profile", "/api/widget", "/api/settings"])
def test_endpoints(client, path):
    r = client.get(path, headers=AUTH)
    assert r.status_code == 200, r.text


def test_unknown_metric_404(client):
    assert client.get("/api/trends/nope", headers=AUTH).status_code == 404


def test_settings_roundtrip(client):
    assert client.put("/api/settings", headers=AUTH, json={"theme": "dark"}).json()["saved"]
    assert client.get("/api/settings", headers=AUTH).json()["theme"] == "dark"


def test_mcp_requires_key(client):
    r = client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    assert r.status_code == 401


def test_mcp_initialize_and_list_tools(client):
    headers = {**AUTH, "Accept": "application/json, text/event-stream", "Content-Type": "application/json"}
    init = client.post("/mcp", headers=headers, json={
        "jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "test", "version": "1"}}})
    assert init.status_code == 200, init.text
    listed = client.post("/mcp", headers={**headers, "MCP-Protocol-Version": "2025-06-18"},
                         json={"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}})
    names = {t["name"] for t in listed.json()["result"]["tools"]}
    assert names == {fn.__name__ for fn in tools.TOOLS}


def test_tool_outputs_are_compact_json():
    out = json.loads(tools.get_daily_summary())
    assert "timeline" not in json.dumps(out)
    assert len(tools.get_daily_summary()) < 15000


def test_raw_passthrough(client):
    r = client.get("/api/raw/get_user_summary?args=2026-01-05", headers=AUTH)
    assert r.status_code == 200 and "totalSteps" in r.json()
    assert client.get("/api/raw/delete_activity?args=1", headers=AUTH).status_code == 404
