"""Backup Manager — Advance Tools plugin.

List, create, schedule and download Supervisor backups through the
Supervisor REST API (requires hassio_api + hassio_role: backup in
config.yaml). Scheduled backups are created by a background loop and old
ones this tool created are cleaned up automatically ("keep last N").

Settings live in /data/backup_manager.json:
  { "schedule": {...}, "auto_slugs": ["a1b2c3d4", ...] }
"""
import asyncio
import datetime
import json
import re
from pathlib import Path

import aiohttp
from aiohttp import web

X = None  # core context (set in register)
TOOL_DIR = Path(__file__).parent

SUPERVISOR = "http://supervisor"

# Folders the Supervisor can put in a partial backup (fixed set).
FOLDERS = [
    {"id": "homeassistant", "name": "Home Assistant configuration"},
    {"id": "ssl", "name": "SSL certificates"},
    {"id": "share", "name": "Share folder"},
    {"id": "media", "name": "Media folder"},
    {"id": "addons/local", "name": "Local add-ons"},
]
FOLDER_IDS = {f["id"] for f in FOLDERS}

CREATE_TIMEOUT = 3600          # seconds a backup may take
SCHEDULE_TICK = 30             # scheduler wake-up interval

_LOCK = asyncio.Lock()         # settings file lock

# state of the (single) running create job — shown in the UI
_JOB = {"running": False, "type": "", "name": "", "started": None,
        "scheduled": False, "error": "", "slug": "", "finished": None}


# ---------------------------------------------------------------- storage

def _store_file():
    return X.DATA / "backup_manager.json"


def _default_schedule():
    return {
        "enabled": False,
        "time": "03:00",
        "weekdays": [],            # [] = every day; 0=Mon … 6=Sun
        "type": "full",            # full | partial
        "homeassistant": True,     # partial only
        "addons": [],              # partial only
        "folders": ["homeassistant"],  # partial only
        "keep": 5,                 # keep last N scheduled backups; 0 = keep all
        "name_prefix": "Scheduled backup",
        "password": "",
        "exclude_database": False,
        "last_run": "",            # "YYYY-MM-DD" of the last fired run
    }


def _load_store():
    f = _store_file()
    data = {}
    if f.exists():
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            X.log.exception("backup_manager: could not read %s", f)
    sched = _default_schedule()
    sched.update(data.get("schedule") or {})
    return {"schedule": sched, "auto_slugs": list(data.get("auto_slugs") or [])}


def _save_store(data):
    f = _store_file()
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2),
                   encoding="utf-8")
    tmp.replace(f)


# ---------------------------------------------------------------- Supervisor REST

def _headers():
    return {"Authorization": f"Bearer {X.SUPERVISOR_TOKEN}"}


async def _sup(method, path, payload=None, timeout=20):
    """Call the Supervisor API. Returns (http_status, data_dict).

    Supervisor wraps everything as {"result": "ok"|"error", "data"|"message"}.
    On success data is unwrapped; on error the message is under "message".
    """
    if not X.SUPERVISOR_TOKEN:
        raise web.HTTPServiceUnavailable(text="no Supervisor connection")
    async with aiohttp.ClientSession() as s:
        async with s.request(method, SUPERVISOR + path, headers=_headers(),
                             json=payload,
                             timeout=aiohttp.ClientTimeout(total=timeout)) as r:
            text = await r.text()
            try:
                body = json.loads(text) if text else {}
            except ValueError:
                body = {}
            if body.get("result") == "ok":
                return r.status, body.get("data") or {}
            msg = body.get("message") or text[:300] or f"HTTP {r.status}"
            return r.status, {"message": msg}


def _err(status, data, fallback):
    return web.json_response(
        {"error": str(data.get("message", fallback))}, status=502)


# ---------------------------------------------------------------- time helpers

def _ha_now():
    """Current time in Home Assistant's configured time zone."""
    tz = None
    try:
        from zoneinfo import ZoneInfo
        name = getattr(X.HA, "_bm_tz", "") or ""
        if name:
            tz = ZoneInfo(name)
    except Exception:
        tz = None
    return datetime.datetime.now(tz)


async def _refresh_tz():
    try:
        cfg = await X.HA.ws_call({"type": "get_config"})
        X.HA._bm_tz = (cfg or {}).get("time_zone", "") or ""
    except Exception:
        pass


def _next_run(sched, now=None):
    """datetime of the next scheduled run, or None."""
    if not sched.get("enabled"):
        return None
    try:
        hh, mm = [int(p) for p in str(sched.get("time", "03:00")).split(":")]
    except ValueError:
        hh, mm = 3, 0
    days = sched.get("weekdays") or []
    now = now or _ha_now()
    for off in range(0, 8):
        day = now + datetime.timedelta(days=off)
        if days and day.weekday() not in days:
            continue
        run = day.replace(hour=hh, minute=mm, second=0, microsecond=0)
        if run > now:
            return run
    return None


# ---------------------------------------------------------------- create job

def _build_create_request(spec):
    """(path, payload) for /backups/new/... from a validated spec."""
    payload = {"name": spec["name"]}
    if spec.get("password"):
        payload["password"] = spec["password"]
    if spec.get("exclude_database"):
        payload["homeassistant_exclude_database"] = True
    if not spec.get("compressed", True):
        payload["compressed"] = False
    if spec["type"] == "full":
        return "/backups/new/full", payload
    if spec.get("homeassistant"):
        payload["homeassistant"] = True
    if spec.get("addons"):
        payload["addons"] = spec["addons"]
    if spec.get("folders"):
        payload["folders"] = spec["folders"]
    return "/backups/new/partial", payload


async def _run_create(spec, scheduled=False):
    """Run one backup to completion; updates _JOB. Returns slug or ''."""
    _JOB.update(running=True, type=spec["type"], name=spec["name"],
                started=_ha_now().isoformat(timespec="seconds"),
                scheduled=scheduled, error="", slug="", finished=None)
    slug = ""
    try:
        path, payload = _build_create_request(spec)
        status, data = await _sup("POST", path, payload,
                                  timeout=CREATE_TIMEOUT)
        if status in (200, 201) and data.get("slug"):
            slug = data["slug"]
            _JOB["slug"] = slug
        else:
            _JOB["error"] = str(data.get("message", f"HTTP {status}"))
    except asyncio.TimeoutError:
        _JOB["error"] = "backup timed out after 60 minutes"
    except Exception as exc:
        _JOB["error"] = str(exc)
    finally:
        _JOB["running"] = False
        _JOB["finished"] = _ha_now().isoformat(timespec="seconds")
    if _JOB["error"]:
        X.log.warning("backup_manager: backup failed: %s", _JOB["error"])
    else:
        X.log.info("backup_manager: backup %s created (%s)", slug, spec["name"])
    return slug


async def _retention(store):
    """Delete the oldest scheduled backups beyond schedule.keep."""
    keep = int(store["schedule"].get("keep") or 0)
    if keep <= 0 or not store["auto_slugs"]:
        return
    status, data = await _sup("GET", "/backups")
    if status != 200:
        return
    existing = {b["slug"]: b for b in data.get("backups", [])}
    # forget slugs the user already deleted by hand
    store["auto_slugs"] = [s for s in store["auto_slugs"] if s in existing]
    auto = sorted(store["auto_slugs"],
                  key=lambda s: existing[s].get("date", ""))
    for slug in auto[:-keep] if len(auto) > keep else []:
        st, d = await _sup("DELETE", f"/backups/{slug}", timeout=60)
        if st == 200:
            store["auto_slugs"].remove(slug)
            X.log.info("backup_manager: retention removed old backup %s", slug)
        else:
            X.log.warning("backup_manager: retention could not remove %s: %s",
                          slug, d.get("message"))


async def _scheduler():
    """Background loop: fire the scheduled backup once per due day."""
    await asyncio.sleep(10)          # let the HA connection come up first
    await _refresh_tz()
    tz_check = 0
    while True:
        try:
            async with _LOCK:
                store = _load_store()
            sched = store["schedule"]
            now = _ha_now()
            if sched.get("enabled") and not _JOB["running"]:
                today = now.strftime("%Y-%m-%d")
                day_ok = (not sched.get("weekdays")
                          or now.weekday() in sched["weekdays"])
                time_ok = now.strftime("%H:%M") >= sched.get("time", "03:00")
                if day_ok and time_ok and sched.get("last_run") != today:
                    spec = {
                        "type": sched.get("type", "full"),
                        "name": f"{sched.get('name_prefix') or 'Scheduled backup'} "
                                f"{now.strftime('%Y-%m-%d %H:%M')}",
                        "password": sched.get("password", ""),
                        "homeassistant": bool(sched.get("homeassistant", True)),
                        "addons": sched.get("addons") or [],
                        "folders": sched.get("folders") or [],
                        "exclude_database": bool(sched.get("exclude_database")),
                    }
                    async with _LOCK:
                        store = _load_store()
                        store["schedule"]["last_run"] = today
                        _save_store(store)
                    slug = await _run_create(spec, scheduled=True)
                    async with _LOCK:
                        store = _load_store()
                        if slug:
                            store["auto_slugs"].append(slug)
                        await _retention(store)
                        _save_store(store)
        except Exception:
            X.log.exception("backup_manager: scheduler error")
        tz_check += 1
        if tz_check >= 120:          # refresh the HA time zone hourly
            tz_check = 0
            await _refresh_tz()
        await asyncio.sleep(SCHEDULE_TICK)


# ---------------------------------------------------------------- validation

def _validate_spec(body):
    t = body.get("type")
    if t not in ("full", "partial"):
        return None, "backup type must be full or partial"
    name = str(body.get("name") or "").strip()
    if not name:
        name = "Backup " + _ha_now().strftime("%Y-%m-%d %H:%M")
    spec = {
        "type": t,
        "name": name[:120],
        "password": str(body.get("password") or ""),
        "exclude_database": bool(body.get("exclude_database")),
        "compressed": body.get("compressed", True) is not False,
        "homeassistant": bool(body.get("homeassistant", True)),
        "addons": body.get("addons") or [],
        "folders": body.get("folders") or [],
    }
    if t == "partial":
        if not isinstance(spec["addons"], list) or \
                not all(isinstance(a, str) for a in spec["addons"]):
            return None, "addons must be a list of add-on slugs"
        if not isinstance(spec["folders"], list) or \
                not all(f in FOLDER_IDS for f in spec["folders"]):
            return None, "invalid folder in the folders list"
        if not (spec["homeassistant"] or spec["addons"] or spec["folders"]):
            return None, "a partial backup needs at least one thing to back up"
    return spec, None


def _validate_schedule(body):
    sched = _default_schedule()
    sched["enabled"] = bool(body.get("enabled"))
    time_s = str(body.get("time") or "03:00")
    if not re.match(r"^([01]\d|2[0-3]):[0-5]\d$", time_s):
        return None, "time must be HH:MM (24h)"
    sched["time"] = time_s
    days = body.get("weekdays") or []
    if not isinstance(days, list) or \
            not all(isinstance(d, int) and 0 <= d <= 6 for d in days):
        return None, "weekdays must be numbers 0 (Mon) to 6 (Sun)"
    sched["weekdays"] = sorted(set(days))
    if body.get("type") not in ("full", "partial"):
        return None, "backup type must be full or partial"
    sched["type"] = body["type"]
    sched["homeassistant"] = bool(body.get("homeassistant", True))
    addons = body.get("addons") or []
    if not isinstance(addons, list) or \
            not all(isinstance(a, str) for a in addons):
        return None, "addons must be a list of add-on slugs"
    sched["addons"] = addons
    folders = body.get("folders") or []
    if not isinstance(folders, list) or \
            not all(f in FOLDER_IDS for f in folders):
        return None, "invalid folder in the folders list"
    sched["folders"] = folders
    if sched["type"] == "partial" and not (
            sched["homeassistant"] or sched["addons"] or sched["folders"]):
        return None, "a partial backup needs at least one thing to back up"
    try:
        keep = int(body.get("keep", 5))
    except (TypeError, ValueError):
        return None, "keep must be a number"
    if not 0 <= keep <= 50:
        return None, "keep must be between 0 (keep all) and 50"
    sched["keep"] = keep
    sched["name_prefix"] = (str(body.get("name_prefix") or "").strip()
                            or "Scheduled backup")[:60]
    sched["password"] = str(body.get("password") or "")
    sched["exclude_database"] = bool(body.get("exclude_database"))
    return sched, None


# ---------------------------------------------------------------- pages

async def page_tool(request):
    if not X.is_admin(request):
        raise web.HTTPFound("/?d=__admin__")
    return web.FileResponse(TOOL_DIR / "static" / "index.html")


# ---------------------------------------------------------------- API

async def api_overview(request):
    """Everything the main screen needs in one call."""
    X.require_admin(request)
    status, data = await _sup("GET", "/backups/info")
    if status != 200:
        return _err(status, data, "could not list backups")
    backups = sorted(data.get("backups", []),
                     key=lambda b: b.get("date", ""), reverse=True)
    async with _LOCK:
        store = _load_store()
    sched = dict(store["schedule"])
    sched.pop("password", None)
    sched["has_password"] = bool(store["schedule"].get("password"))
    nxt = _next_run(store["schedule"])
    now = _ha_now()
    return web.json_response({
        "backups": backups,
        "auto_slugs": store["auto_slugs"],
        "days_until_stale": data.get("days_until_stale"),
        "schedule": sched,
        "next_run": nxt.isoformat(timespec="minutes") if nxt else None,
        "now": now.isoformat(timespec="seconds"),
        "tz": getattr(X.HA, "_bm_tz", "") or "server time",
        "job": dict(_JOB),
        "connected": X.HA.connected,
    })


async def api_addons(request):
    """Installed add-ons (for the partial backup picker) via /supervisor/info."""
    X.require_admin(request)
    status, data = await _sup("GET", "/supervisor/info")
    if status != 200:
        return _err(status, data, "could not read add-on list")
    addons = [{"slug": a.get("slug"), "name": a.get("name") or a.get("slug"),
               "version": a.get("version", "")}
              for a in data.get("addons", []) if a.get("slug")]
    addons.sort(key=lambda a: a["name"].lower())
    return web.json_response({"addons": addons, "folders": FOLDERS})


async def api_backup_info(request):
    X.require_admin(request)
    slug = request.match_info["slug"]
    if not re.match(r"^[a-f0-9]{8}$", slug):
        return web.json_response({"error": "bad backup slug"}, status=400)
    status, data = await _sup("GET", f"/backups/{slug}/info")
    if status != 200:
        return _err(status, data, "could not read backup info")
    return web.json_response({"info": data})


async def api_create(request):
    X.require_admin(request)
    if _JOB["running"]:
        return web.json_response(
            {"error": "a backup is already being created — wait for it "
                      "to finish"}, status=409)
    body = await request.json()
    spec, err = _validate_spec(body)
    if err:
        return web.json_response({"error": err}, status=400)
    asyncio.create_task(_run_create(spec))
    return web.json_response({"ok": True, "started": True})


async def api_job(request):
    X.require_admin(request)
    return web.json_response({"job": dict(_JOB)})


async def api_delete(request):
    X.require_admin(request)
    slug = request.match_info["slug"]
    if not re.match(r"^[a-f0-9]{8}$", slug):
        return web.json_response({"error": "bad backup slug"}, status=400)
    status, data = await _sup("DELETE", f"/backups/{slug}", timeout=60)
    if status != 200:
        return _err(status, data, "could not delete backup")
    async with _LOCK:
        store = _load_store()
        if slug in store["auto_slugs"]:
            store["auto_slugs"].remove(slug)
            _save_store(store)
    return web.json_response({"ok": True})


async def api_download(request):
    """Stream the backup tar from the Supervisor to the browser."""
    X.require_admin(request)
    slug = request.match_info["slug"]
    if not re.match(r"^[a-f0-9]{8}$", slug):
        return web.json_response({"error": "bad backup slug"}, status=400)
    if not X.SUPERVISOR_TOKEN:
        raise web.HTTPServiceUnavailable(text="no Supervisor connection")

    # friendly filename from the backup name
    fname = slug
    status, data = await _sup("GET", f"/backups/{slug}/info")
    if status == 200 and data.get("name"):
        safe = re.sub(r"[^A-Za-z0-9 _.-]+", "", data["name"]).strip()
        if safe:
            fname = f"{safe} ({slug})"

    timeout = aiohttp.ClientTimeout(total=None, sock_read=300)
    async with aiohttp.ClientSession(timeout=timeout) as s:
        async with s.get(f"{SUPERVISOR}/backups/{slug}/download",
                         headers=_headers()) as r:
            if r.status != 200:
                return web.json_response(
                    {"error": f"Supervisor returned HTTP {r.status} for the "
                              "download"}, status=502)
            resp = web.StreamResponse(headers={
                "Content-Type": "application/x-tar",
                "Content-Disposition":
                    f'attachment; filename="{fname}.tar"',
            })
            if r.headers.get("Content-Length"):
                resp.headers["Content-Length"] = r.headers["Content-Length"]
            await resp.prepare(request)
            async for chunk in r.content.iter_chunked(1 << 16):
                await resp.write(chunk)
            await resp.write_eof()
            return resp


async def api_reload(request):
    X.require_admin(request)
    status, data = await _sup("POST", "/backups/reload", timeout=60)
    if status != 200:
        return _err(status, data, "could not reload backups")
    return web.json_response({"ok": True})


async def api_get_schedule(request):
    X.require_admin(request)
    async with _LOCK:
        store = _load_store()
    sched = dict(store["schedule"])
    sched.pop("password", None)
    sched["has_password"] = bool(store["schedule"].get("password"))
    nxt = _next_run(store["schedule"])
    return web.json_response({
        "schedule": sched,
        "next_run": nxt.isoformat(timespec="minutes") if nxt else None,
    })


async def api_save_schedule(request):
    X.require_admin(request)
    body = await request.json()
    sched, err = _validate_schedule(body)
    if err:
        return web.json_response({"error": err}, status=400)
    async with _LOCK:
        store = _load_store()
        old = store["schedule"]
        sched["last_run"] = old.get("last_run", "")
        # keep the stored password unless the user typed a new one or
        # explicitly cleared it
        if body.get("password") is None and not body.get("clear_password"):
            sched["password"] = old.get("password", "")
        if body.get("clear_password"):
            sched["password"] = ""
        store["schedule"] = sched
        _save_store(store)
    nxt = _next_run(sched)
    return web.json_response({
        "ok": True,
        "next_run": nxt.isoformat(timespec="minutes") if nxt else None,
    })


# ---------------------------------------------------------------- register

def register(app, ctx, manifest):
    global X
    X = ctx
    base = "/api/tools/backup_manager"
    app.router.add_get("/tools/backup_manager/", page_tool)
    app.router.add_get(f"{base}/overview", api_overview)
    app.router.add_get(f"{base}/addons", api_addons)
    app.router.add_get(f"{base}/backups/{{slug}}/info", api_backup_info)
    app.router.add_get(f"{base}/backups/{{slug}}/download", api_download)
    app.router.add_delete(f"{base}/backups/{{slug}}", api_delete)
    app.router.add_post(f"{base}/create", api_create)
    app.router.add_get(f"{base}/job", api_job)
    app.router.add_post(f"{base}/reload", api_reload)
    app.router.add_get(f"{base}/schedule", api_get_schedule)
    app.router.add_post(f"{base}/schedule", api_save_schedule)

    async def _start_scheduler(app):
        app["bm_scheduler"] = asyncio.create_task(_scheduler())

    async def _stop_scheduler(app):
        task = app.get("bm_scheduler")
        if task:
            task.cancel()

    app.on_startup.append(_start_scheduler)
    app.on_cleanup.append(_stop_scheduler)
