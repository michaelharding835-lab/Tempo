"""Environment configuration. Every value comes from an environment variable."""

from __future__ import annotations

import os


def _env(*names: str, default: str | None = None) -> str | None:
    for name in names:
        value = os.getenv(name)
        if value:
            return value.strip()
    return default


# Shared secret the phone app (and MCP clients) must send as "Authorization: Bearer <key>".
APP_ACCESS_KEY = _env("APP_ACCESS_KEY")

# Initial Garmin tokens (JSON printed by scripts/garmin_login.py). Refreshed tokens are
# written to the store, which takes priority over this value once it holds tokens.
GARMIN_TOKENS = _env("GARMIN_TOKENS", "GARMINTOKENS")

# Run against generated sample data instead of a real Garmin account.
GARMIN_FAKE = (_env("GARMIN_FAKE", default="0") or "0").lower() in {"1", "true", "yes"}

# Upstash Redis (Vercel Marketplace sets the KV_* names; Upstash direct sets UPSTASH_*).
REDIS_URL = _env("KV_REST_API_URL", "UPSTASH_REDIS_REST_URL")
REDIS_TOKEN = _env("KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_TOKEN")

# AI coach
ANTHROPIC_API_KEY = _env("ANTHROPIC_API_KEY")
COACH_MODEL = _env("COACH_MODEL", default="claude-sonnet-5-5")
# "mcp" = Claude calls this server's /mcp endpoint through the MCP connector.
# "local" = the backend runs the same tools itself (used automatically on localhost).
COACH_MODE = _env("COACH_MODE", default="mcp")

# Public base URL of this deployment (Vercel sets VERCEL_PROJECT_PRODUCTION_URL).
PUBLIC_URL = _env("PUBLIC_URL")
if not PUBLIC_URL and os.getenv("VERCEL_PROJECT_PRODUCTION_URL"):
    PUBLIC_URL = "https://" + os.environ["VERCEL_PROJECT_PRODUCTION_URL"]

VERSION = "1.0.0"
