"""The Garmin MCP server (Streamable HTTP, stateless, JSON responses).

Mounted by app.py at /mcp and protected by the same access key as the app. Claude
reaches it through the Messages API MCP connector; Claude Code can add it with
`claude mcp add --transport http garmin https://<your-app>/mcp --header "Authorization: Bearer <key>"`.
"""

from __future__ import annotations

from mcp.server.mcpserver import MCPServer
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations

from . import tools

server = MCPServer(
    name="tempo-garmin",
    title="Garmin (Tempo)",
    instructions=(
        "Read-only access to one athlete's Garmin Connect data: daily health metrics, "
        "activities, training status, trends and HYROX analysis. Dates are YYYY-MM-DD in "
        "the athlete's time zone. Prefer get_daily_summary for 'today' questions."
    ),
    version="1.0.0",
)

_read_only = ToolAnnotations(readOnlyHint=True, openWorldHint=False)

for _fn in tools.TOOLS:
    server.tool(name=_fn.__name__, description=(_fn.__doc__ or "").strip(), annotations=_read_only,
                structured_output=False)(_fn)

# Build the Starlette app once so the session manager exists; app.py runs it in its lifespan.
asgi_app = server.streamable_http_app(
    streamable_http_path="/mcp",
    stateless_http=True,
    json_response=True,
    transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
)
session_manager = server.session_manager
