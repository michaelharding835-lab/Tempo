"""Tiny key-value store: Upstash Redis over REST when configured, memory otherwise.

Used for three things: the rotating Garmin tokens, a short-lived response cache,
and the app's synced settings.
"""

from __future__ import annotations

import json
import threading
import time
from typing import Any

import requests

from . import config


class _MemoryStore:
    kind = "memory"

    def __init__(self) -> None:
        self._data: dict[str, tuple[float | None, str]] = {}
        self._lock = threading.Lock()

    def get(self, key: str) -> str | None:
        with self._lock:
            item = self._data.get(key)
            if not item:
                return None
            expires, value = item
            if expires is not None and expires < time.time():
                self._data.pop(key, None)
                return None
            return value

    def set(self, key: str, value: str, ttl: int | None = None) -> None:
        with self._lock:
            self._data[key] = (time.time() + ttl if ttl else None, value)

    def delete(self, key: str) -> None:
        with self._lock:
            self._data.pop(key, None)


class _UpstashStore:
    kind = "upstash"

    def __init__(self, url: str, token: str) -> None:
        self._url = url.rstrip("/")
        self._session = requests.Session()
        self._session.headers["Authorization"] = f"Bearer {token}"

    def _cmd(self, *args: Any) -> Any:
        r = self._session.post(self._url, json=[str(a) for a in args], timeout=6)
        r.raise_for_status()
        body = r.json()
        if "error" in body:
            raise RuntimeError(body["error"])
        return body.get("result")

    def get(self, key: str) -> str | None:
        return self._cmd("GET", key)

    def set(self, key: str, value: str, ttl: int | None = None) -> None:
        if ttl:
            self._cmd("SET", key, value, "EX", int(ttl))
        else:
            self._cmd("SET", key, value)

    def delete(self, key: str) -> None:
        self._cmd("DEL", key)


class Store:
    """Wraps a backend and never lets a store outage break a request."""

    def __init__(self) -> None:
        self._memory = _MemoryStore()
        self._remote = (
            _UpstashStore(config.REDIS_URL, config.REDIS_TOKEN)
            if config.REDIS_URL and config.REDIS_TOKEN
            else None
        )

    @property
    def kind(self) -> str:
        return self._remote.kind if self._remote else self._memory.kind

    def get(self, key: str) -> str | None:
        value = self._memory.get(key)
        if value is not None or not self._remote:
            return value
        try:
            return self._remote.get(key)
        except Exception:
            return None

    def get_fresh(self, key: str) -> str | None:
        """Read the shared copy first (used for tokens other instances may rotate)."""
        if self._remote:
            try:
                value = self._remote.get(key)
                if value is not None:
                    return value
            except Exception:
                pass
        return self._memory.get(key)

    def set(self, key: str, value: str, ttl: int | None = None) -> None:
        self._memory.set(key, value, ttl)
        if self._remote:
            try:
                self._remote.set(key, value, ttl)
            except Exception:
                pass

    def delete(self, key: str) -> None:
        self._memory.delete(key)
        if self._remote:
            try:
                self._remote.delete(key)
            except Exception:
                pass

    def get_json(self, key: str) -> Any:
        raw = self.get(key)
        if raw is None:
            return None
        try:
            return json.loads(raw)
        except ValueError:
            return None

    def set_json(self, key: str, value: Any, ttl: int | None = None) -> None:
        self.set(key, json.dumps(value, separators=(",", ":"), default=str), ttl)


store = Store()
