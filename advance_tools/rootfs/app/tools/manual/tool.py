"""Manual — Advance Tools plugin.

The built-in user guide: one searchable page documenting every tool.
Static content only; no API endpoints.
"""
from pathlib import Path

from aiohttp import web

X = None
TOOL_DIR = Path(__file__).parent


async def page_tool(request):
    if not X.is_admin(request):
        raise web.HTTPFound("/?d=__admin__")
    return web.FileResponse(TOOL_DIR / "static" / "index.html")


def register(app, ctx, manifest):
    global X
    X = ctx
    app.router.add_get("/tools/manual/", page_tool)
