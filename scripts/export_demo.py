"""Write the app's sample-data snapshot (web/src/demo/snapshot.json).

Runs the real backend code against the fake Garmin account, so sample mode shows
exactly what the live app would. Usage: python scripts/export_demo.py
"""

from __future__ import annotations

import json
import os
import sys
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ["GARMIN_FAKE"] = "1"

from backend import service  # noqa: E402
from backend.fake_garmin import FakeGarmin  # noqa: E402


def main() -> None:
    g = FakeGarmin.shared()
    today = g.today
    out: dict = {"generated": today.isoformat(), "today": {}, "details": {}, "trends": {}, "calendar": {}}
    for i in range(7):
        d = (today - timedelta(days=i)).isoformat()
        out["today"][d] = service.today(d)
    out["activities"] = service.activities(0, 100)["items"]
    for a in out["activities"][:40]:
        out["details"][str(a["id"])] = service.activity(a["id"])
    out["training"] = service.training(today.isoformat())
    for metric in list(service.TRENDS) + ["training_load", "run_distance"]:
        out["trends"][metric] = service.trends(metric, 366, today.isoformat())
    for k in range(4):
        y, m = today.year, today.month - k
        while m < 1:
            y, m = y - 1, m + 12
        out["calendar"][f"{y}-{m}"] = service.calendar(y, m)
    out["hyrox"] = service.hyrox_history()
    out["profile"] = service.profile()
    dest = ROOT / "web" / "src" / "demo" / "snapshot.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(out, separators=(",", ":"), default=str)
    dest.write_text(text)
    print(f"wrote {dest} ({len(text) // 1024} KB)")


if __name__ == "__main__":
    main()
