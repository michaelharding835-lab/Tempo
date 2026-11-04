"""Garmin Connect session management, caching and parallel fetching.

The Garmin library uses short-lived access tokens plus a refresh token that can
rotate on every refresh. Serverless instances come and go, so the current token
set lives in the shared store and is re-saved whenever it changes.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

from . import config
from .store import store

log = logging.getLogger("tempo.garmin")

TOKENS_KEY = "garmin:tokens"
MFA_STATE_KEY = "garmin:mfa_state"


class GarminNotConnected(Exception):
    """No usable Garmin tokens: the user needs to connect their account."""


class GarminRateLimited(Exception):
    """Garmin asked us to slow down."""


_lock = threading.Lock()
_client: Any = None
_client_tokens: str | None = None
_client_born = 0.0


def _garmin_module():
    import garminconnect  # imported lazily so fake mode never needs network libs

    return garminconnect


def _is_auth_error(exc: BaseException) -> bool:
    gc = _garmin_module()
    if isinstance(exc, gc.GarminConnectAuthenticationError):
        return True
    text = str(exc).lower()
    return "401" in text or "unauthorized" in text


def _is_rate_limited(exc: BaseException) -> bool:
    gc = _garmin_module()
    return isinstance(exc, gc.GarminConnectTooManyRequestsError) or "429" in str(exc)


def current_tokens() -> str | None:
    return store.get_fresh(TOKENS_KEY) or config.GARMIN_TOKENS


def save_tokens(tokens: str) -> None:
    store.set(TOKENS_KEY, tokens)


def _build_client(tokens: str) -> Any:
    gc = _garmin_module()
    client = gc.Garmin(retry_attempts=2)
    client.login(tokenstore=tokens)
    return client


def get_client(force_reload: bool = False) -> Any:
    """Return a logged-in client (or the fake one), reusing it while it is warm."""
    global _client, _client_tokens, _client_born
    if config.GARMIN_FAKE:
        from .fake_garmin import FakeGarmin

        return FakeGarmin.shared()

    with _lock:
        if _client is not None and not force_reload and time.time() - _client_born < 6 * 3600:
            return _client
        tokens = current_tokens()
        if not tokens:
            raise GarminNotConnected("Garmin is not connected yet.")
        try:
            client = _build_client(tokens)
        except Exception as exc:  # noqa: BLE001
            if _is_rate_limited(exc):
                raise GarminRateLimited(str(exc)) from exc
            raise GarminNotConnected(f"Garmin rejected the saved login: {exc}") from exc
        _client, _client_tokens, _client_born = client, tokens, time.time()
        persist_if_rotated()
        return client


def persist_if_rotated() -> None:
    """Save the token set if the library refreshed it since we last saved."""
    global _client_tokens
    if config.GARMIN_FAKE or _client is None:
        return
    try:
        dumped = _client.client.dumps()
    except Exception:  # noqa: BLE001
        return
    if dumped and dumped != _client_tokens:
        save_tokens(dumped)
        _client_tokens = dumped


def call(method: str, *args: Any, **kwargs: Any) -> Any:
    """Call a Garmin method, retrying once with reloaded tokens on auth failure."""
    client = get_client()
    try:
        result = getattr(client, method)(*args, **kwargs)
    except Exception as exc:  # noqa: BLE001
        if config.GARMIN_FAKE:
            raise
        if _is_rate_limited(exc):
            raise GarminRateLimited(str(exc)) from exc
        if not _is_auth_error(exc):
            raise
        client = get_client(force_reload=True)
        result = getattr(client, method)(*args, **kwargs)
    persist_if_rotated()
    return result


_pool = ThreadPoolExecutor(max_workers=8)


def gather(calls: dict[str, tuple]) -> tuple[dict[str, Any], dict[str, str]]:
    """Run several Garmin calls in parallel.

    ``calls`` maps a name to ``(method, *args)``. Returns ``(results, errors)``; a
    failed call yields ``None`` in results and a message in errors, so one missing
    metric never takes down a whole screen.
    """
    get_client()  # log in once up front, not eight times in parallel
    futures = {name: _pool.submit(call, spec[0], *spec[1:]) for name, spec in calls.items()}
    results: dict[str, Any] = {}
    errors: dict[str, str] = {}
    for name, fut in futures.items():
        try:
            results[name] = fut.result(timeout=40)
        except (GarminNotConnected, GarminRateLimited):
            raise
        except Exception as exc:  # noqa: BLE001
            log.info("garmin call %s failed: %s", name, exc)
            results[name] = None
            errors[name] = str(exc)[:200]
    return results, errors


def cached(key: str, ttl: int, fn: Callable[[], Any], fresh: bool = False) -> Any:
    """Serve from the store when possible; fall back to a stale copy if Garmin fails."""
    full_key = f"cache:{key}"
    stale_key = f"stale:{key}"
    if not fresh:
        hit = store.get_json(full_key)
        if hit is not None:
            return hit
    try:
        value = fn()
    except (GarminNotConnected, GarminRateLimited):
        stale = store.get_json(stale_key)
        if stale is not None:
            stale["stale"] = True
            return stale
        raise
    store.set_json(full_key, value, ttl)
    store.set_json(stale_key, value, 14 * 86400)
    return value


# ---------------------------------------------------------------- account linking


def connect_with_tokens(tokens: str) -> dict[str, Any]:
    """Validate a token JSON (from scripts/garmin_login.py) and store it."""
    global _client, _client_tokens, _client_born
    tokens = tokens.strip()
    json.loads(tokens)  # must be JSON
    client = _build_client(tokens)
    with _lock:
        _client, _client_tokens, _client_born = client, None, time.time()
    save_tokens(client.client.dumps())
    _client_tokens = client.client.dumps()
    return {"connected": True, "name": client.get_full_name()}


def login_with_password(email: str, password: str) -> dict[str, Any]:
    """Log in from the cloud. Garmin sometimes blocks data-centre logins; the
    laptop script is the fallback."""
    global _client, _client_tokens, _client_born
    gc = _garmin_module()
    client = gc.Garmin(email, password, return_on_mfa=True)
    status, state = client.login()
    if status == "needs_mfa":
        store.set_json(MFA_STATE_KEY, state, ttl=600)
        return {"connected": False, "needs_mfa": True}
    with _lock:
        _client, _client_born = client, time.time()
    save_tokens(client.client.dumps())
    _client_tokens = client.client.dumps()
    return {"connected": True, "name": client.get_full_name()}


def finish_mfa(code: str) -> dict[str, Any]:
    global _client, _client_tokens, _client_born
    gc = _garmin_module()
    state = store.get_json(MFA_STATE_KEY)
    if not state:
        raise GarminNotConnected("The sign-in timed out. Start again.")
    client = gc.Garmin(return_on_mfa=True)
    client.resume_login(state, code.strip())
    store.delete(MFA_STATE_KEY)
    with _lock:
        _client, _client_born = client, time.time()
    save_tokens(client.client.dumps())
    _client_tokens = client.client.dumps()
    return {"connected": True, "name": client.get_full_name()}


def disconnect() -> None:
    global _client, _client_tokens
    store.delete(TOKENS_KEY)
    with _lock:
        _client, _client_tokens = None, None
