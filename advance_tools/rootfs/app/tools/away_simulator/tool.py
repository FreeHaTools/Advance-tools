"""Away Simulator — Advance Tools plugin.

Vacation presence simulation. Replays the REAL on/off history of selected
lights and switches from N days ago (default 7 = same weekday last week),
with a random time offset per action, so the house looks genuinely lived-in
while everyone is away.

* Plan builder: fetches the reference day's history through HA's REST
  history API, extracts on/off transitions, applies jitter once, clamps to
  the active window and stores today's schedule in /data/away_simulator.json.
* Runner: a background task checks every 30 seconds for due actions and
  fires homeassistant.turn_on / turn_off. It pauses automatically while any
  person.* entity is "home" (optional) and rebuilds the plan at day rollover.
"""
import asyncio
import json
import random
from datetime import datetime, time as dtime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote

import aiohttp
from aiohttp import web

X = None  # core context, injected by the loader
TOOL_DIR = Path(__file__).parent

CORE_API = "http://supervisor/core/api"
ALLOWED_DOMAINS = ("light", "switch")
LOG_RING = 100          # log entries kept on disk
LOOP_SECONDS = 30       # runner tick interval
MAX_ENTITIES = 60

_LOCK = asyncio.Lock()  # guards CFG mutation + file writes
CFG = None              # lazily loaded config dict

# ---------------------------------------------------------------- persistence


def _file():
    return X.DATA / "away_simulator.json"


def _default_config():
    return {
        "enabled": False,
        "entities": [],
        "days_back": 7,
        "jitter_min": 15,
        "window": {"from": "00:00", "to": "23:59"},
        "pause_when_home": True,
        "plan": {},
        "log": [],
    }


def _cfg():
    global CFG
    if CFG is None:
        CFG = _default_config()
        try:
            if _file().exists():
                saved = json.loads(_file().read_text(encoding="utf-8"))
                if isinstance(saved, dict):
                    CFG.update(saved)
        except Exception:
            X.log.exception("away_simulator: failed to read config — using defaults")
    return CFG


def _save(cfg):
    """Atomic write (tmp + replace)."""
    tmp = _file().with_suffix(".tmp")
    tmp.write_text(json.dumps(cfg, ensure_ascii=False, indent=2),
                   encoding="utf-8")
    tmp.replace(_file())


def _log_entry(cfg, text, **extra):
    entry = {"ts": datetime.now(_tz()).isoformat(timespec="seconds"),
             "text": text}
    entry.update(extra)
    log = cfg.setdefault("log", [])
    log.append(entry)
    if len(log) > LOG_RING:
        del log[:len(log) - LOG_RING]

# ---------------------------------------------------------------- time helpers


def _tz():
    return datetime.now().astimezone().tzinfo


def _hhmm_to_min(value, default=None):
    try:
        h, m = str(value).split(":")
        h, m = int(h), int(m)
        if 0 <= h <= 23 and 0 <= m <= 59:
            return h * 60 + m
    except (ValueError, AttributeError):
        pass
    return default


def _min_to_hhmm(v):
    return f"{v // 60:02d}:{v % 60:02d}"


def _in_window(t, w_from, w_to):
    if w_from <= w_to:
        return w_from <= t <= w_to
    return t >= w_from or t <= w_to    # overnight window (e.g. 18:00 → 02:00)

# ---------------------------------------------------------------- HA REST


async def _core_rest(method, path):
    """Call HA Core REST API through the Supervisor proxy."""
    if not X.SUPERVISOR_TOKEN:
        raise RuntimeError("no HA connection (missing SUPERVISOR_TOKEN)")
    headers = {"Authorization": f"Bearer {X.SUPERVISOR_TOKEN}",
               "Content-Type": "application/json"}
    async with aiohttp.ClientSession() as s:
        async with s.request(method, CORE_API + path, headers=headers,
                             timeout=aiohttp.ClientTimeout(total=30)) as r:
            text = await r.text()
            try:
                data = json.loads(text) if text else {}
            except ValueError:
                data = {"raw": text}
            return r.status, data

# ---------------------------------------------------------------- plan builder


async def _build_plan(cfg):
    """Build today's schedule from the reference day's real history."""
    tz = _tz()
    now = datetime.now(tz)
    today = now.date()
    days_back = max(1, min(30, int(cfg.get("days_back") or 7)))
    ref = today - timedelta(days=days_back)
    plan = {"date": today.isoformat(), "ref_date": ref.isoformat(),
            "built_at": now.isoformat(timespec="seconds"),
            "actions": [], "skipped": []}

    entities = [e for e in (cfg.get("entities") or []) if isinstance(e, str)]
    if not entities:
        return plan

    day_start = datetime.combine(ref, dtime.min, tzinfo=tz)
    day_end = day_start + timedelta(days=1)
    start_iso = day_start.astimezone(timezone.utc).isoformat()
    end_iso = day_end.astimezone(timezone.utc).isoformat()
    path = ("/history/period/" + quote(start_iso)
            + "?end_time=" + quote(end_iso)
            + "&filter_entity_id=" + ",".join(quote(e) for e in entities)
            + "&minimal_response")
    status, data = await _core_rest("GET", path)
    if status != 200 or not isinstance(data, list):
        msg = data.get("message") if isinstance(data, dict) else None
        raise RuntimeError(msg or f"history API returned HTTP {status}")

    # minimal_response: one list per entity; only the first item is
    # guaranteed to carry entity_id (later items have state + last_changed).
    hist = {}
    for series in data:
        if series and isinstance(series, list):
            eid = (series[0] or {}).get("entity_id")
            if eid:
                hist[eid] = series

    jitter = max(0, min(120, int(cfg.get("jitter_min") or 0)))
    window = cfg.get("window") or {}
    w_from = _hhmm_to_min(window.get("from"), 0)
    w_to = _hhmm_to_min(window.get("to"), 1439)

    actions = []
    for eid in entities:
        found = False
        prev = None
        for item in hist.get(eid) or []:
            state = str(item.get("state", "")).lower()
            if state not in ("on", "off"):
                continue          # ignore unavailable / unknown
            when = item.get("last_changed") or item.get("last_updated")
            try:
                t_local = datetime.fromisoformat(
                    str(when).replace("Z", "+00:00")).astimezone(tz)
            except (ValueError, TypeError):
                continue
            if t_local <= day_start:
                prev = state      # snapshot of the state at day start
                continue
            if prev is not None and state == prev:
                continue          # no real on/off transition
            prev = state
            base = t_local.hour * 60 + t_local.minute
            sched = base + (random.randint(-jitter, jitter) if jitter else 0)
            sched = max(0, min(1439, sched))
            if not _in_window(sched, w_from, w_to):
                continue
            actions.append({"t": _min_to_hhmm(sched), "entity_id": eid,
                            "action": state, "done": False})
            found = True
        if not found:
            plan["skipped"].append(eid)

    # Actions already in the past (plan built mid-day) must not fire in a
    # burst — mark them done/missed right away.
    now_min = now.hour * 60 + now.minute
    for a in actions:
        if _hhmm_to_min(a["t"], 0) < now_min:
            a["done"] = True
            a["missed"] = True

    actions.sort(key=lambda a: (a["t"], a["entity_id"]))
    plan["actions"] = actions
    return plan


async def _rebuild(cfg, reason):
    """Rebuild the plan in place; returns an error string or None."""
    try:
        plan = await _build_plan(cfg)
        cfg["plan"] = plan
        _log_entry(cfg, f"Plan rebuilt ({reason}): {len(plan['actions'])} "
                        f"actions replaying {plan['ref_date']}")
        return None
    except Exception as exc:
        old = cfg.get("plan") or {}
        today = datetime.now(_tz()).date().isoformat()
        if old.get("date") != today:      # keep a still-valid plan for today
            cfg["plan"] = {"date": today, "actions": [], "skipped": [],
                           "error": str(exc)}
        else:
            old["error"] = str(exc)
        _log_entry(cfg, f"Plan build failed ({reason}): {exc}")
        return str(exc)

# ---------------------------------------------------------------- status


def _someone_home():
    for eid, st in X.HA.states.items():
        if eid.startswith("person.") and st.get("state") == "home":
            return True
    return False


def _status(cfg):
    if not cfg.get("enabled"):
        return "disabled"
    if cfg.get("pause_when_home") and _someone_home():
        return "paused_home"
    plan = cfg.get("plan") or {}
    today = datetime.now(_tz()).date().isoformat()
    if plan.get("date") != today or not plan.get("actions"):
        return "no_plan"
    return "active"

# ---------------------------------------------------------------- runner task


async def _tick():
    cfg = _cfg()
    if not cfg.get("enabled") or not X.HA.connected:
        return
    tz = _tz()
    now = datetime.now(tz)
    today = now.date().isoformat()
    async with _LOCK:
        plan = cfg.get("plan") or {}
        if plan.get("date") != today:
            await _rebuild(cfg, "day rollover")
            _save(cfg)
            plan = cfg.get("plan") or {}
        if cfg.get("pause_when_home") and _someone_home():
            return                         # paused — someone is home
        now_min = now.hour * 60 + now.minute
        due = [a for a in plan.get("actions") or []
               if not a.get("done") and _hhmm_to_min(a["t"], 0) <= now_min]
        if not due:
            return
        # Coalesce: if several actions for one entity are due at once (e.g.
        # after a pause), only the newest fires — it decides the final state.
        newest = {}
        for a in due:
            newest[a["entity_id"]] = a
        for a in due:
            a["done"] = True
            if newest.get(a["entity_id"]) is not a:
                a["skipped"] = True
                continue
            svc = "turn_on" if a["action"] == "on" else "turn_off"
            try:
                await X.HA.call_service("homeassistant", svc,
                                        target={"entity_id": a["entity_id"]})
                _log_entry(cfg, f"{_friendly(a['entity_id'])} → "
                                f"{a['action'].upper()} (scheduled {a['t']})",
                           entity_id=a["entity_id"], action=a["action"],
                           ok=True)
            except Exception as exc:
                _log_entry(cfg, f"Failed to turn {a['action']} "
                                f"{a['entity_id']}: {exc}",
                           entity_id=a["entity_id"], action=a["action"],
                           ok=False)
        _save(cfg)


async def _runner():
    await asyncio.sleep(5)                 # let the HA connection come up
    while True:
        try:
            await _tick()
        except asyncio.CancelledError:
            raise
        except Exception:
            X.log.exception("away_simulator: runner tick failed")
        await asyncio.sleep(LOOP_SECONDS)


async def _on_startup(app):
    app["away_simulator_task"] = asyncio.create_task(_runner())


async def _on_cleanup(app):
    task = app.get("away_simulator_task")
    if task:
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass

# ---------------------------------------------------------------- helpers


def _friendly(eid):
    st = X.HA.states.get(eid) or {}
    return (st.get("attributes") or {}).get("friendly_name") or eid


def _err(exc_or_msg, status=502):
    return web.json_response({"error": str(exc_or_msg)}, status=status)


def _public(cfg, error=None):
    out = {
        "ok": error is None,
        "connected": X.HA.connected,
        "config": {k: cfg.get(k) for k in
                   ("enabled", "entities", "days_back", "jitter_min",
                    "window", "pause_when_home")},
        "plan": cfg.get("plan") or {},
        "status": _status(cfg),
    }
    if error:
        out["error"] = error
    return out

# ---------------------------------------------------------------- pages


async def page_tool(request):
    if not X.is_admin(request):
        raise web.HTTPFound("/?d=__admin__")
    return web.FileResponse(TOOL_DIR / "static" / "index.html")

# ---------------------------------------------------------------- API


async def api_data(request):
    X.require_admin(request)
    cfg = _cfg()
    entities = []
    persons = []
    for eid, st in sorted(X.HA.states.items()):
        domain = eid.split(".")[0]
        attrs = st.get("attributes") or {}
        if domain in ALLOWED_DOMAINS:
            entities.append({"id": eid,
                             "name": attrs.get("friendly_name") or eid,
                             "domain": domain,
                             "state": st.get("state")})
        elif domain == "person":
            persons.append({"name": attrs.get("friendly_name")
                            or eid.split(".", 1)[1],
                            "state": st.get("state")})
    out = _public(cfg)
    out["log"] = (cfg.get("log") or [])[-30:]
    out["entities"] = entities
    out["persons"] = persons
    return web.json_response(out)


async def api_config(request):
    X.require_admin(request)
    try:
        body = await request.json()
    except Exception:
        return _err("invalid JSON body", 400)
    if not isinstance(body, dict):
        return _err("body must be an object", 400)

    async with _LOCK:
        cfg = _cfg()
        if "entities" in body:
            ents = body["entities"]
            if not isinstance(ents, list):
                return _err("entities must be a list", 400)
            clean = []
            for e in ents:
                e = str(e).strip()
                if e.split(".")[0] not in ALLOWED_DOMAINS or "." not in e:
                    return _err(f"unsupported entity: {e} "
                                "(lights and switches only)", 400)
                if e not in clean:
                    clean.append(e)
            if len(clean) > MAX_ENTITIES:
                return _err(f"too many entities (max {MAX_ENTITIES})", 400)
            cfg["entities"] = clean
        if "days_back" in body:
            try:
                db = int(body["days_back"])
            except (ValueError, TypeError):
                return _err("days_back must be a number", 400)
            if not 1 <= db <= 30:
                return _err("days_back must be between 1 and 30", 400)
            cfg["days_back"] = db
        if "jitter_min" in body:
            try:
                jm = int(body["jitter_min"])
            except (ValueError, TypeError):
                return _err("jitter_min must be a number", 400)
            if not 0 <= jm <= 120:
                return _err("jitter_min must be between 0 and 120", 400)
            cfg["jitter_min"] = jm
        if "window" in body:
            w = body["window"] or {}
            f = _hhmm_to_min(w.get("from"))
            t = _hhmm_to_min(w.get("to"))
            if f is None or t is None:
                return _err("window times must be HH:MM", 400)
            cfg["window"] = {"from": _min_to_hhmm(f), "to": _min_to_hhmm(t)}
        if "pause_when_home" in body:
            cfg["pause_when_home"] = bool(body["pause_when_home"])

        error = None
        if not cfg["entities"]:
            cfg["plan"] = {}
        elif X.HA.connected:
            error = await _rebuild(cfg, "config change")
        _save(cfg)
        return web.json_response(_public(cfg, error))


async def api_enable(request):
    X.require_admin(request)
    try:
        body = await request.json()
    except Exception:
        return _err("invalid JSON body", 400)
    enabled = bool(body.get("enabled"))
    async with _LOCK:
        cfg = _cfg()
        cfg["enabled"] = enabled
        error = None
        if enabled:
            if not cfg.get("entities"):
                cfg["enabled"] = False
                _save(cfg)
                return _err("pick at least one light or switch first", 400)
            if X.HA.connected:
                error = await _rebuild(cfg, "enabled")
            _log_entry(cfg, "Simulation enabled")
        else:
            _log_entry(cfg, "Simulation disabled")
        _save(cfg)
        return web.json_response(_public(cfg, error))


async def api_rebuild(request):
    X.require_admin(request)
    if not X.HA.connected:
        return _err("not connected to Home Assistant", 503)
    async with _LOCK:
        cfg = _cfg()
        if not cfg.get("entities"):
            return _err("pick at least one light or switch first", 400)
        error = await _rebuild(cfg, "manual rebuild")
        _save(cfg)
        return web.json_response(_public(cfg, error))


async def api_test(request):
    """Blink an entity (on → 1.5 s → off) so the user can verify control."""
    X.require_admin(request)
    try:
        body = await request.json()
    except Exception:
        return _err("invalid JSON body", 400)
    eid = str(body.get("entity_id", "")).strip()
    if eid.split(".")[0] not in ALLOWED_DOMAINS or "." not in eid:
        return _err("entity must be a light or switch", 400)
    if not X.HA.connected:
        return _err("not connected to Home Assistant", 503)
    try:
        await X.HA.call_service("homeassistant", "turn_on",
                                target={"entity_id": eid})
        await asyncio.sleep(1.5)
        await X.HA.call_service("homeassistant", "turn_off",
                                target={"entity_id": eid})
    except Exception as exc:
        return _err(exc)
    return web.json_response({"ok": True})

# ---------------------------------------------------------------- register


def register(app, ctx, manifest):
    global X
    X = ctx
    base = "/api/tools/away_simulator"
    app.router.add_get("/tools/away_simulator/", page_tool)

    app.router.add_get(f"{base}/data", api_data)
    app.router.add_post(f"{base}/config", api_config)
    app.router.add_post(f"{base}/enable", api_enable)
    app.router.add_post(f"{base}/rebuild", api_rebuild)
    app.router.add_post(f"{base}/test", api_test)

    app.on_startup.append(_on_startup)
    app.on_cleanup.append(_on_cleanup)
