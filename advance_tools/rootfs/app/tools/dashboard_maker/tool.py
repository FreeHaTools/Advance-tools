"""Dashboard Maker — Advance Tools plugin.

Multi-user HTML dashboards for wall tablets: visual designer, card styles,
skin packs, per-dashboard entity allowlist, WebSocket live states.

All routes keep their original (v1.x Advance Tools) paths so existing tablets,
bookmarks and sessions keep working.
"""
import asyncio
import datetime
import io
import json
import os
import re
import secrets
import zipfile
from fnmatch import fnmatch

import aiohttp
from aiohttp import WSMsgType, web

X = None          # core context (set by register)
DASH_DIR = None   # /data/dashboards
PACKS_FILE = None
STYLES_FILE = None

DEFAULT_DESIGN = {
    "title": "",
    "theme": {"accent": "#4f8cff", "bg": "#0f1420", "card": "#1a2233",
              "text": "#e8edf7", "cols": 4, "radius": 14},
    "widgets": [],
}

# ---------------------------------------------------------------- helpers

def make_matcher(dash: dict):
    """Return f(entity_id)->bool for a dashboard's allowlist."""
    if dash.get("allow_all"):
        return lambda eid: True
    patterns = [p.strip() for p in dash.get("entities", []) if p.strip()]
    return lambda eid: any(fnmatch(eid, p) for p in patterns)


def collect_entity_ids(service_data, target):
    """All entity_ids referenced by a service call (for allowlist check)."""
    out = []
    for src in (service_data or {}), (target or {}):
        v = src.get("entity_id")
        if isinstance(v, str):
            out.append(v)
        elif isinstance(v, list):
            out.extend(v)
    return out


def _dash_or_403(request):
    slug = request.match_info["slug"]
    name = X.request_user(request)
    if not name:
        raise web.HTTPFound(f"/?d={slug}" if X.SLUG_RE.match(slug) else "/")
    if not X.SLUG_RE.match(slug) or slug not in X.STORE.data["dashboards"]:
        raise web.HTTPNotFound()
    if not X.STORE.can_access(name, slug):
        raise web.HTTPForbidden(text="no access to this dashboard")
    return slug


def _admin_dash_dir(request):
    X.require_admin(request)
    slug = request.match_info["slug"]
    if not X.SLUG_RE.match(slug) or slug not in X.STORE.data["dashboards"]:
        raise web.HTTPNotFound()
    d = DASH_DIR / slug
    d.mkdir(parents=True, exist_ok=True)
    return slug, d


def _design_path(slug):
    return DASH_DIR / slug / "design.json"

# ---------------------------------------------------------------- pages

async def page_tool(request):
    """Tool home = the Dashboard Maker console."""
    if not X.is_admin(request):
        raise web.HTTPFound("/?d=__admin__")
    return web.FileResponse(X.APP / "static" / "admin.html")


async def page_designer(request):
    if not X.is_admin(request):
        raise web.HTTPFound("/?d=__admin__")
    return web.FileResponse(X.APP / "static" / "designer.html")

# ---------------------------------------------------------------- dashboard serving

async def serve_dashboard_index(request):
    slug = _dash_or_403(request)
    dash = X.STORE.data["dashboards"][slug]
    if dash.get("mode") == "design":
        html = (X.APP / "static" / "render.html").read_text(encoding="utf-8")
        inject = (f'<script src="/static/panel.js" data-dashboard="{slug}"></script>'
                  f'<script src="/static/render.js?v=100" data-dashboard="{slug}"></script>')
        return web.Response(text=html.replace("</body>", inject + "</body>"),
                            content_type="text/html")
    index = DASH_DIR / slug / "index.html"
    if not index.exists():
        return web.Response(text="<h1>Dashboard has no index.html yet</h1>",
                            content_type="text/html")
    html = index.read_text(encoding="utf-8")
    inject = f'<script src="/static/panel.js" data-dashboard="{slug}"></script>'
    if re.search(r"</body>", html, re.IGNORECASE):
        html = re.sub(r"</body>", inject + "</body>", html, count=1, flags=re.IGNORECASE)
    else:
        html += inject
    return web.Response(text=html, content_type="text/html")


async def serve_dashboard_asset(request):
    slug = _dash_or_403(request)
    rel = request.match_info["path"]
    base = (DASH_DIR / slug).resolve()
    target = (base / rel).resolve()
    if not target.is_relative_to(base) or not target.is_file():
        raise web.HTTPNotFound()
    return web.FileResponse(target)

# ---------------------------------------------------------------- panel WebSocket

async def ws_panel(request):
    slug = request.query.get("d", "")
    name = X.request_user(request)
    if (not name or slug not in X.STORE.data["dashboards"]
            or not X.STORE.can_access(name, slug)):
        raise web.HTTPForbidden()

    dash = X.STORE.data["dashboards"][slug]
    matcher = make_matcher(dash)

    ws = web.WebSocketResponse(heartbeat=30)
    await ws.prepare(request)

    queue = asyncio.Queue()
    listener = (queue, matcher)
    X.HA.listeners.add(listener)

    async def pump():
        while True:
            item = await queue.get()
            await ws.send_json(item)

    pump_task = asyncio.create_task(pump())
    try:
        await ws.send_json({"type": "states", "connected": X.HA.connected,
                            "states": {e: s for e, s in X.HA.states.items()
                                       if matcher(e)}})
        async for raw in ws:
            if raw.type != WSMsgType.TEXT:
                break
            try:
                msg = raw.json()
            except Exception:
                continue
            mtype = msg.get("type")
            if mtype == "call":
                domain = str(msg.get("domain", ""))
                service = str(msg.get("service", ""))
                sdata = msg.get("data") or {}
                target = msg.get("target") or {}
                eids = collect_entity_ids(sdata, target)
                if not eids or not all(matcher(e) for e in eids):
                    await ws.send_json({"type": "error", "id": msg.get("id"),
                                        "error": "entity not allowed for this dashboard"})
                    continue
                try:
                    await X.HA.call_service(domain, service, sdata, target)
                    await ws.send_json({"type": "result", "id": msg.get("id"), "ok": True})
                except Exception as exc:
                    await ws.send_json({"type": "error", "id": msg.get("id"),
                                        "error": str(exc)})
            elif mtype == "ping":
                await ws.send_json({"type": "pong"})
    finally:
        X.HA.listeners.discard(listener)
        pump_task.cancel()
    return ws

# ---------------------------------------------------------------- admin API

async def admin_save_dashboard(request):
    X.require_admin(request)
    body = await request.json()
    slug = str(body.get("slug", "")).strip()
    if not X.SLUG_RE.match(slug):
        return web.json_response(
            {"error": "slug must be a-z, 0-9, _ (max 40 chars)"}, status=400)
    async with X.STORE.lock:
        dash = X.STORE.data["dashboards"].get(slug, {})
        dash["name"] = str(body.get("name") or slug)
        dash["entities"] = [p.strip() for p in body.get("entities", []) if p.strip()]
        dash["allow_all"] = bool(body.get("allow_all"))
        if body.get("mode") in ("design", "html"):
            dash["mode"] = body["mode"]
        dash.setdefault("mode", "design")
        X.STORE.data["dashboards"][slug] = dash
        X.STORE.save()
    ddir = DASH_DIR / slug
    ddir.mkdir(parents=True, exist_ok=True)
    index = ddir / "index.html"
    if not index.exists():
        index.write_text((X.APP / "static" / "sample-dashboard.html")
                         .read_text(encoding="utf-8").replace("__NAME__", dash["name"]),
                         encoding="utf-8")
    return web.json_response({"ok": True})


async def admin_delete_dashboard(request):
    X.require_admin(request)
    slug = request.match_info["slug"]
    async with X.STORE.lock:
        X.STORE.data["dashboards"].pop(slug, None)
        X.STORE.save()
    ddir = DASH_DIR / slug
    if X.SLUG_RE.match(slug) and ddir.exists():
        import shutil
        shutil.rmtree(ddir)
    return web.json_response({"ok": True})


async def admin_get_html(request):
    _, ddir = _admin_dash_dir(request)
    index = ddir / "index.html"
    return web.json_response(
        {"html": index.read_text(encoding="utf-8") if index.exists() else ""})


async def admin_put_html(request):
    slug, ddir = _admin_dash_dir(request)
    body = await request.json()
    (ddir / "index.html").write_text(str(body.get("html", "")), encoding="utf-8")
    async with X.STORE.lock:
        X.STORE.data["dashboards"][slug]["mode"] = "html"
        X.STORE.save()
    return web.json_response({"ok": True})


async def admin_list_files(request):
    _, ddir = _admin_dash_dir(request)
    files = sorted(str(p.relative_to(ddir)).replace("\\", "/")
                   for p in ddir.rglob("*") if p.is_file())
    return web.json_response({"files": files})


async def admin_upload(request):
    _, ddir = _admin_dash_dir(request)
    reader = await request.multipart()
    saved = []
    while True:
        part = await reader.next()
        if part is None:
            break
        if not part.filename:
            continue
        data = await part.read(decode=False)
        fname = os.path.basename(part.filename)
        if fname.lower().endswith(".zip"):
            zf = zipfile.ZipFile(io.BytesIO(data))
            for zi in zf.infolist():
                if zi.is_dir():
                    continue
                rel = zi.filename.replace("\\", "/")
                if rel.startswith("/") or ".." in rel.split("/"):
                    continue
                dest = (ddir / rel).resolve()
                if not dest.is_relative_to(ddir.resolve()):
                    continue
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(zf.read(zi))
                saved.append(rel)
        else:
            (ddir / fname).write_bytes(data)
            saved.append(fname)
    return web.json_response({"ok": True, "saved": saved})


async def admin_delete_file(request):
    _, ddir = _admin_dash_dir(request)
    rel = request.match_info["path"]
    target = (ddir / rel).resolve()
    if not target.is_relative_to(ddir.resolve()) or not target.is_file():
        raise web.HTTPNotFound()
    target.unlink()
    return web.json_response({"ok": True})

# ---------------------------------------------------------------- visual designer

async def admin_get_design(request):
    slug, _ = _admin_dash_dir(request)
    p = _design_path(slug)
    design = (json.loads(p.read_text(encoding="utf-8")) if p.exists()
              else dict(DEFAULT_DESIGN))
    return web.json_response(
        {"design": design,
         "mode": X.STORE.data["dashboards"][slug].get("mode", "html")})


async def admin_put_design(request):
    slug, ddir = _admin_dash_dir(request)
    body = await request.json()
    design = body.get("design")
    if not isinstance(design, dict) or not isinstance(design.get("widgets"), list):
        return web.json_response({"error": "invalid design"}, status=400)
    _design_path(slug).write_text(json.dumps(design, ensure_ascii=False, indent=2),
                                  encoding="utf-8")
    async with X.STORE.lock:
        X.STORE.data["dashboards"][slug]["mode"] = "design"
        X.STORE.save()
    return web.json_response({"ok": True})

# ---------------------------------------------------------------- packs

def _load_packs():
    if PACKS_FILE.exists():
        return json.loads(PACKS_FILE.read_text(encoding="utf-8"))
    return []


def _save_packs(packs):
    PACKS_FILE.write_text(json.dumps(packs, ensure_ascii=False, indent=2),
                          encoding="utf-8")


def _migrate_legacy_styles():
    """Wrap v0.x styles.json into a standard pack once."""
    if not STYLES_FILE.exists():
        return
    styles = json.loads(STYLES_FILE.read_text(encoding="utf-8"))
    if styles:
        packs = _load_packs()
        packs.append({"pack": "advance-tools-pack", "format": 1,
                      "pid": "legacy-" + secrets.token_hex(3),
                      "name": "Imported styles (migrated)", "version": "1.0.0",
                      "items": [dict(s, kind="style") for s in styles]})
        _save_packs(packs)
    STYLES_FILE.unlink()
    X.log.info("Migrated %d legacy custom style(s) into a pack", len(styles))


def _validate_pack(p):
    if not isinstance(p, dict) or p.get("pack") != "advance-tools-pack":
        return 'not a Advance Tools Pack (missing "pack": "advance-tools-pack")'
    if p.get("format") != 1:
        return 'unsupported "format" (expected 1)'
    if not str(p.get("name", "")).strip():
        return 'pack needs a "name"'
    items = p.get("items")
    if not isinstance(items, list) or not items:
        return 'pack needs a non-empty "items" list'
    for i, it in enumerate(items):
        kind = it.get("kind")
        if kind == "style":
            if ".CARD" not in str(it.get("css", "")):
                return f"item {i}: style css must contain .CARD"
        elif kind == "skin":
            if not it.get("html") or not it.get("for"):
                return f'item {i}: skin needs "html" and "for"'
        else:
            return f'item {i}: kind must be "style" or "skin"'
        if not str(it.get("id", "")).strip():
            it["id"] = re.sub(r"[^a-z0-9]+", "-",
                              str(it.get("name", "item")).lower()).strip("-")[:30] \
                       + "-" + secrets.token_hex(2)
        if not str(it.get("name", "")).strip():
            return f'item {i}: needs a "name"'
        it.setdefault("category", "Custom")
    return None


async def admin_get_packs(request):
    X.require_admin(request)
    return web.json_response({"packs": _load_packs()})


async def admin_import_pack(request):
    X.require_admin(request)
    try:
        pack = await request.json()
    except Exception:
        return web.json_response({"error": "invalid JSON"}, status=400)
    err = _validate_pack(pack)
    if err:
        return web.json_response({"error": err}, status=400)
    pack["pid"] = "p-" + secrets.token_hex(4)
    packs = _load_packs()
    packs.append(pack)
    _save_packs(packs)
    return web.json_response({"ok": True, "pid": pack["pid"],
                              "items": len(pack["items"])})


async def admin_delete_pack(request):
    X.require_admin(request)
    pid = request.match_info["pid"]
    _save_packs([p for p in _load_packs() if p.get("pid") != pid])
    return web.json_response({"ok": True})

# ---------------------------------------------------------------- runtime APIs

async def api_design(request):
    """Design JSON for the runtime renderer — any user with dashboard access."""
    slug = request.query.get("d", "")
    name = X.request_user(request)
    if (not name or slug not in X.STORE.data["dashboards"]
            or not X.STORE.can_access(name, slug)):
        raise web.HTTPForbidden()
    p = _design_path(slug)
    design = (json.loads(p.read_text(encoding="utf-8")) if p.exists()
              else dict(DEFAULT_DESIGN))
    if not design.get("title"):
        design["title"] = X.STORE.data["dashboards"][slug].get("name", slug)
    design["custom_packs"] = _load_packs()
    return web.json_response(design)


async def api_history(request):
    """Proxy HA history for one entity (sparklines / charts). Access-controlled."""
    slug = request.query.get("d", "")
    entity = request.query.get("entity", "")
    hours = min(168, max(1, int(request.query.get("hours", "24") or 24)))
    name = X.request_user(request)
    if (not name or slug not in X.STORE.data["dashboards"]
            or not X.STORE.can_access(name, slug)):
        raise web.HTTPForbidden()
    if not make_matcher(X.STORE.data["dashboards"][slug])(entity):
        raise web.HTTPForbidden(text="entity not allowed for this dashboard")
    if not X.SUPERVISOR_TOKEN:
        return web.json_response({"points": []})
    start = (datetime.datetime.utcnow() - datetime.timedelta(hours=hours)
             ).strftime("%Y-%m-%dT%H:%M:%SZ")
    url = (f"http://supervisor/core/api/history/period/{start}"
           f"?filter_entity_id={entity}&minimal_response&significant_changes_only")
    headers = {"Authorization": f"Bearer {X.SUPERVISOR_TOKEN}"}
    points = []
    try:
        async with aiohttp.ClientSession() as s:
            async with s.get(url, headers=headers,
                             timeout=aiohttp.ClientTimeout(total=12)) as r:
                data = await r.json()
        series = data[0] if data else []
        for item in series:
            attrs = item.get("attributes") or {}
            val = attrs.get("current_temperature")
            if val is None:
                try:
                    val = float(item.get("state"))
                except (TypeError, ValueError):
                    val = None
            if val is not None:
                points.append({"t": item.get("last_changed") or item.get("last_updated"),
                               "v": val})
    except Exception as exc:
        X.log.warning("history fetch failed for %s: %s", entity, exc)
    return web.json_response({"points": points})


async def api_camera(request):
    """Proxy an HA camera/image entity (vacuum maps etc.). Access-controlled."""
    slug = request.query.get("d", "")
    entity = request.query.get("entity", "")
    name = X.request_user(request)
    if (not name or slug not in X.STORE.data["dashboards"]
            or not X.STORE.can_access(name, slug)):
        raise web.HTTPForbidden()
    if not make_matcher(X.STORE.data["dashboards"][slug])(entity):
        raise web.HTTPForbidden(text="entity not allowed for this dashboard")
    if not X.SUPERVISOR_TOKEN:
        raise web.HTTPServiceUnavailable(text="no HA connection")
    dom = entity.split(".")[0]
    if dom == "image":
        st = X.HA.states.get(entity) or {}
        path = (st.get("attributes") or {}).get("entity_picture")
        url = "http://supervisor/core" + path if path else None
    else:
        url = f"http://supervisor/core/api/camera_proxy/{entity}"
    if not url:
        raise web.HTTPNotFound()
    headers = {"Authorization": f"Bearer {X.SUPERVISOR_TOKEN}"}
    try:
        async with aiohttp.ClientSession() as s:
            async with s.get(url, headers=headers,
                             timeout=aiohttp.ClientTimeout(total=12)) as r:
                if r.status != 200:
                    raise web.HTTPBadGateway(text=f"camera {r.status}")
                body = await r.read()
                ctype = r.headers.get("Content-Type", "image/jpeg")
        return web.Response(body=body, content_type=ctype.split(";")[0],
                            headers={"Cache-Control": "no-store"})
    except web.HTTPException:
        raise
    except Exception as exc:
        X.log.warning("camera fetch failed for %s: %s", entity, exc)
        raise web.HTTPBadGateway(text="camera fetch failed")

# ---------------------------------------------------------------- register

def register(app, ctx, manifest):
    global X, DASH_DIR, PACKS_FILE, STYLES_FILE
    X = ctx
    DASH_DIR = ctx.DATA / "dashboards"
    PACKS_FILE = ctx.DATA / "packs.json"
    STYLES_FILE = ctx.DATA / "styles.json"
    DASH_DIR.mkdir(parents=True, exist_ok=True)
    _migrate_legacy_styles()

    # tool home + legacy admin console paths
    app.router.add_get("/tools/dashboard_maker/", page_tool)
    app.router.add_get("/admin/designer", page_designer)

    # runtime (dashboards + live data)
    app.router.add_get("/api/ws", ws_panel)
    app.router.add_get("/api/design", api_design)
    app.router.add_get("/api/history", api_history)
    app.router.add_get("/api/camera", api_camera)
    app.router.add_get("/d/{slug}/", serve_dashboard_index)
    app.router.add_get("/d/{slug}",
                       lambda r: web.HTTPFound(f"/d/{r.match_info['slug']}/"))
    app.router.add_get("/d/{slug}/{path:.+}", serve_dashboard_asset)

    # admin API (identical v1.x paths)
    app.router.add_post("/api/admin/dashboards", admin_save_dashboard)
    app.router.add_delete("/api/admin/dashboards/{slug}", admin_delete_dashboard)
    app.router.add_get("/api/admin/dashboards/{slug}/html", admin_get_html)
    app.router.add_put("/api/admin/dashboards/{slug}/html", admin_put_html)
    app.router.add_get("/api/admin/dashboards/{slug}/files", admin_list_files)
    app.router.add_post("/api/admin/dashboards/{slug}/upload", admin_upload)
    app.router.add_delete("/api/admin/dashboards/{slug}/files/{path:.+}",
                          admin_delete_file)
    app.router.add_get("/api/admin/dashboards/{slug}/design", admin_get_design)
    app.router.add_put("/api/admin/dashboards/{slug}/design", admin_put_design)
    app.router.add_get("/api/admin/packs", admin_get_packs)
    app.router.add_post("/api/admin/packs", admin_import_pack)
    app.router.add_delete("/api/admin/packs/{pid}", admin_delete_pack)
