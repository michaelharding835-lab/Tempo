"""Tempo: a personal Garmin app.

One FastAPI app (Vercel deploys it as a single function) that serves:
  /            the iPhone web app (built into web/dist)
  /api/...     JSON for the app, pulled from Garmin Connect when you open it
  /mcp         an MCP server over the same data (used by the coach and Claude Code)
"""

from __future__ import annotations

import hmac
import logging
import os
from contextlib import asynccontextmanager
from typing import Any

from fastapi import Body, Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse

from backend import coach, config, service
from backend import garmin as gm
from backend.mcp_server import session_manager
from backend.store import store

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(_: FastAPI):
    async with session_manager.run():
        yield


app = FastAPI(title="Tempo", version=config.VERSION, lifespan=lifespan, docs_url=None, redoc_url=None)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ---------------------------------------------------------------- auth


def _key_ok(header: str | None) -> bool:
    if config.GARMIN_FAKE and not config.APP_ACCESS_KEY:
        return True  # sample-data mode with no key set is open
    if not config.APP_ACCESS_KEY:
        return False
    token = (header or "").removeprefix("Bearer ").strip()
    return hmac.compare_digest(token.encode(), config.APP_ACCESS_KEY.encode())


def require_key(request: Request) -> None:
    if not config.APP_ACCESS_KEY and not config.GARMIN_FAKE:
        raise HTTPException(503, detail={"code": "no_access_key",
                                         "message": "Set APP_ACCESS_KEY in the server's environment variables."})
    if not _key_ok(request.headers.get("authorization")):
        raise HTTPException(401, detail={"code": "bad_key", "message": "The access key doesn't match."})


@app.exception_handler(gm.GarminNotConnected)
async def _not_connected(_: Request, exc: gm.GarminNotConnected):
    return JSONResponse({"detail": {"code": "garmin_not_connected", "message": str(exc)}}, status_code=409)


@app.exception_handler(gm.GarminRateLimited)
async def _rate_limited(_: Request, exc: gm.GarminRateLimited):
    return JSONResponse({"detail": {"code": "garmin_rate_limited",
                                    "message": "Garmin asked us to slow down. Try again in a few minutes."}},
                        status_code=429)


@app.exception_handler(LookupError)
async def _not_found(_: Request, exc: LookupError):
    return JSONResponse({"detail": {"code": "not_found", "message": str(exc)}}, status_code=404)


# ---------------------------------------------------------------- status


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "version": config.VERSION,
        "mode": "sample" if config.GARMIN_FAKE else "live",
        "store": store.kind,
        "garmin_linked": bool(config.GARMIN_FAKE or gm.current_tokens()),
        "access_key_set": bool(config.APP_ACCESS_KEY),
        "coach": bool(config.ANTHROPIC_API_KEY),
    }


@app.get("/api/check", dependencies=[Depends(require_key)])
def check() -> dict[str, Any]:
    """Confirms the key works. Succeeds before Garmin is linked too, so the phone app
    can be set up first and Garmin connected from its Settings."""
    status = health()
    profile = None
    garmin_error = None
    try:
        profile = service.profile_basic()
    except (gm.GarminNotConnected, gm.GarminRateLimited) as exc:
        garmin_error = str(exc)
        status["garmin_linked"] = False
    return {**status, "profile": profile, "garmin_error": garmin_error}


# ---------------------------------------------------------------- data


@app.get("/api/today", dependencies=[Depends(require_key)])
def get_today(date_: str | None = Query(None, alias="date"), fresh: bool = False):
    return service.today(date_, fresh=fresh)


@app.get("/api/activities", dependencies=[Depends(require_key)])
def get_activities(start: int = 0, limit: int = 30, group: str | None = None, fresh: bool = False):
    return service.activities(start, limit, group, fresh=fresh)


@app.get("/api/activities/{activity_id}", dependencies=[Depends(require_key)])
def get_activity(activity_id: int):
    return service.activity(activity_id)


@app.get("/api/training", dependencies=[Depends(require_key)])
def get_training(date_: str | None = Query(None, alias="date"), fresh: bool = False):
    return service.training(date_, fresh=fresh)


@app.get("/api/trends/{metric}", dependencies=[Depends(require_key)])
def get_trend(metric: str, days: int = 28, end: str | None = None):
    try:
        return service.trends(metric, days, end)
    except KeyError:
        raise HTTPException(404, detail={"code": "unknown_metric", "message": f"No metric called {metric}."})


@app.get("/api/calendar", dependencies=[Depends(require_key)])
def get_calendar(year: int | None = None, month: int | None = None):
    today = service.local_today()
    return service.calendar(year or today.year, month or today.month)


@app.get("/api/muscles", dependencies=[Depends(require_key)])
def get_muscles(date_: str | None = Query(None, alias="date"), fresh: bool = False):
    return service.muscles_week(date_, fresh=fresh)


@app.get("/api/hyrox", dependencies=[Depends(require_key)])
def get_hyrox(fresh: bool = False):
    return service.hyrox_history(fresh=fresh)


@app.get("/api/profile", dependencies=[Depends(require_key)])
def get_profile(fresh: bool = False):
    return service.profile(fresh=fresh)


@app.get("/api/widget", dependencies=[Depends(require_key)])
def get_widget(date_: str | None = Query(None, alias="date")):
    return service.widget(date_)


@app.get("/api/raw/{method}", dependencies=[Depends(require_key)])
def get_raw(method: str, args: str = ""):
    """Garmin's unprocessed answer for one library method, e.g.
    /api/raw/get_sleep_data?args=2026-11-04 — for fixing field mappings when Garmin
    changes its JSON."""
    if not method.startswith("get_") or not hasattr(gm.get_client(), method):
        raise HTTPException(404, detail={"code": "unknown_method", "message": f"No Garmin method called {method}."})
    return gm.call(method, *[a for a in args.split(",") if a])


# ---------------------------------------------------------------- synced settings


@app.get("/api/settings", dependencies=[Depends(require_key)])
def get_settings():
    return store.get_json("app:settings") or {}


@app.put("/api/settings", dependencies=[Depends(require_key)])
def put_settings(settings: dict[str, Any] = Body(...)):
    store.set_json("app:settings", settings)
    return {"saved": True}


# ---------------------------------------------------------------- coach


@app.post("/api/coach", dependencies=[Depends(require_key)])
def post_coach(request: Request, payload: dict[str, Any] = Body(...)):
    base = str(request.base_url).rstrip("/")
    forwarded = request.headers.get("x-forwarded-host")
    if forwarded:
        base = f"https://{forwarded}"
    events = coach.stream(payload.get("messages") or [], payload.get("today"), payload.get("about"), base)
    return StreamingResponse(events, media_type="application/x-ndjson",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------------------------------------------------------------- Garmin account


@app.post("/api/garmin/tokens", dependencies=[Depends(require_key)])
def post_tokens(payload: dict[str, Any] = Body(...)):
    try:
        return gm.connect_with_tokens(str(payload.get("tokens") or ""))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, detail={"code": "bad_tokens", "message": f"Garmin didn't accept those tokens: {exc}"})


@app.post("/api/garmin/login", dependencies=[Depends(require_key)])
def post_login(payload: dict[str, Any] = Body(...)):
    try:
        return gm.login_with_password(str(payload.get("email") or ""), str(payload.get("password") or ""))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, detail={"code": "login_failed", "message": (
            f"Garmin refused the sign-in from the cloud ({str(exc)[:160]}). "
            "Use the laptop sign-in script instead and paste the tokens.")})


@app.post("/api/garmin/mfa", dependencies=[Depends(require_key)])
def post_mfa(payload: dict[str, Any] = Body(...)):
    try:
        return gm.finish_mfa(str(payload.get("code") or ""))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, detail={"code": "mfa_failed", "message": f"That code didn't work: {str(exc)[:160]}"})


@app.post("/api/garmin/disconnect", dependencies=[Depends(require_key)])
def post_disconnect():
    gm.disconnect()
    return {"connected": False}


# ---------------------------------------------------------------- MCP (Streamable HTTP)


class _ASGIPassthrough(Response):
    """Hands the raw request to the MCP session manager."""

    def __init__(self, scope: Any, receive: Any) -> None:
        super().__init__()
        self._scope, self._receive = scope, receive

    async def __call__(self, scope: Any, receive: Any, send: Any) -> None:
        await session_manager.handle_request(self._scope, self._receive, send)


@app.api_route("/mcp", methods=["GET", "POST", "DELETE"], include_in_schema=False)
async def mcp_endpoint(request: Request):
    if not config.APP_ACCESS_KEY and not config.GARMIN_FAKE:
        return JSONResponse({"error": "Set APP_ACCESS_KEY to enable the MCP server."}, status_code=503)
    if not _key_ok(request.headers.get("authorization")):
        return JSONResponse({"error": "unauthorized"}, status_code=401,
                            headers={"WWW-Authenticate": 'Bearer realm="tempo"'})
    return _ASGIPassthrough(request.scope, request.receive)


# ---------------------------------------------------------------- the app itself

_dist = os.path.join(os.path.dirname(__file__), "web", "dist")
if os.path.isdir(_dist):
    app.frontend("/", directory=_dist, fallback="index.html")
