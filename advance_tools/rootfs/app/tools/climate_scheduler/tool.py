"""Climate Scheduler — Advance Tools plugin.

Visual weekly temperature schedules for climate entities (thermostats).
The add-on itself enforces the schedules — no Home Assistant automations
are generated. A background loop runs every 60 seconds:

* inside a block  -> make sure the entity is on and its target temperature
                     equals the block temperature;
* outside blocks  -> per schedule setting: turn the entity off, hold a
                     fallback temperature, or do nothing.

Service calls are only made when the live state actually differs
(temperature compared within 0.05 degrees, hvac state != off), so HA is
never spammed. Unavailable entities are skipped.

Persistence: /data/climate_scheduler.json (atomic tmp-file replace,
guarded by an asyncio lock):

    {"schedules": {sid: {"name", "entity_id", "enabled", "blocks",
                         "outside", "outside_temp"}},
     "log": [{"ts", "entity_id", "action", "detail"}, ...]}   # last 50
"""
import asyncio
import contextlib
import json
import re
import time
import uuid
from datetime import datetime
from pathlib import Path

from aiohttp import web

X = None  # core context, injected by the loader
TOOL_DIR = Path(__file__).parent

DAYS = ("monday", "tuesday", "wednesday", "thursday", "friday",
        "saturday", "sunday")
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
OUTSIDE_MODES = ("off", "temp", "nothing")
LOG_MAX = 50
TEMP_EPS = 0.05
LOOP_SECONDS = 60

_LOCK = asyncio.Lock()
_STATE = {"schedules": {}, "log": []}

# ---------------------------------------------------------------- persistence


def _store_path():
    return X.DATA / "climate_scheduler.json"


def _load():
    global _STATE
    path = _store_path()
    if path.exists():
        try:
            _STATE = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            X.log.exception("Climate Scheduler: corrupt store file — starting fresh")
            _STATE = {}
    if not isinstance(_STATE, dict):
        _STATE = {}
    _STATE.setdefault("schedules", {})
    _STATE.setdefault("log", [])


def _save():
    """Atomic write. Call while holding _LOCK."""
    path = _store_path()
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(_STATE, ensure_ascii=False, indent=2),
                   encoding="utf-8")
    tmp.replace(path)


def _append_log(entity_id, action, detail):
    _STATE["log"].append({"ts": int(time.time()), "entity_id": entity_id,
                          "action": action, "detail": detail})
    if len(_STATE["log"]) > LOG_MAX:
        del _STATE["log"][:len(_STATE["log"]) - LOG_MAX]

# ---------------------------------------------------------------- helpers


def _err(exc_or_msg, status=502):
    return web.json_response({"error": str(exc_or_msg)}, status=status)


def _num(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _minutes(hhmm):
    hours, mins = hhmm.split(":")
    return int(hours) * 60 + int(mins)


def _entity_range(entity_id):
    """(min_temp, max_temp) from the live entity, or (None, None)."""
    attrs = (X.HA.states.get(entity_id) or {}).get("attributes") or {}
    return _num(attrs.get("min_temp")), _num(attrs.get("max_temp"))

# ---------------------------------------------------------------- validation


def _validate(schedule):
    """Normalize + validate a schedule. Returns (clean, None) or (None, error)."""
    if not isinstance(schedule, dict):
        return None, "schedule must be an object"

    name = str(schedule.get("name", "")).strip()
    if not name:
        return None, "a name is required"

    entity_id = str(schedule.get("entity_id", "")).strip()
    if not entity_id.startswith("climate.") or len(entity_id) < 9:
        return None, "entity_id must be a climate entity (climate.*)"
    if X.HA.connected and entity_id not in X.HA.states:
        return None, f"unknown climate entity: {entity_id}"

    lo, hi = _entity_range(entity_id)

    def _check_temp(temp, where):
        if lo is not None and temp < lo - 1e-9:
            return f"{where}: {temp}° is below the entity minimum ({lo}°)"
        if hi is not None and temp > hi + 1e-9:
            return f"{where}: {temp}° is above the entity maximum ({hi}°)"
        return None

    blocks_in = schedule.get("blocks") or {}
    if not isinstance(blocks_in, dict):
        return None, "blocks must be an object with one list per day"
    blocks = {}
    for day in DAYS:
        day_in = blocks_in.get(day) or []
        if not isinstance(day_in, list):
            return None, f"{day}: blocks must be a list"
        clean = []
        for raw in day_in:
            if not isinstance(raw, dict):
                return None, f"{day}: each block must be an object"
            t_from = str(raw.get("from", ""))
            t_to = str(raw.get("to", ""))
            if not TIME_RE.match(t_from) or not TIME_RE.match(t_to):
                return None, (f"{day}: times must be HH:MM "
                              f"(got {t_from!r} – {t_to!r})")
            if _minutes(t_from) >= _minutes(t_to):
                return None, f"{day}: block {t_from}–{t_to} needs from < to"
            temp = _num(raw.get("temp"))
            if temp is None:
                return None, (f"{day}: block {t_from}–{t_to} needs a numeric "
                              "temperature")
            bad = _check_temp(temp, f"{day} {t_from}–{t_to}")
            if bad:
                return None, bad
            clean.append({"from": t_from, "to": t_to, "temp": round(temp, 2)})
        clean.sort(key=lambda b: _minutes(b["from"]))
        for a, b in zip(clean, clean[1:]):
            if _minutes(b["from"]) < _minutes(a["to"]):
                return None, (f"{day}: blocks {a['from']}–{a['to']} and "
                              f"{b['from']}–{b['to']} overlap")
        blocks[day] = clean

    outside = schedule.get("outside", "off")
    if outside not in OUTSIDE_MODES:
        return None, "outside must be one of: off, temp, nothing"
    outside_temp = _num(schedule.get("outside_temp", 17.0))
    if outside == "temp":
        if outside_temp is None:
            return None, "a numeric fallback temperature is required"
        bad = _check_temp(outside_temp, "fallback temperature")
        if bad:
            return None, bad
    if outside_temp is None:
        outside_temp = 17.0

    return {
        "name": name,
        "entity_id": entity_id,
        "enabled": bool(schedule.get("enabled", True)),
        "blocks": blocks,
        "outside": outside,
        "outside_temp": round(outside_temp, 2),
    }, None

# ---------------------------------------------------------------- enforcement


def _current_block(schedule, now):
    """The block covering the local time `now`, or None."""
    day_blocks = (schedule.get("blocks") or {}).get(DAYS[now.weekday()]) or []
    cur = now.hour * 60 + now.minute
    for block in day_blocks:
        if _minutes(block["from"]) <= cur < _minutes(block["to"]):
            return block
    return None


async def _enforce(schedule):
    """Apply one schedule to its entity right now.

    Returns (actions, skip_reason). Only calls HA services when the live
    state actually differs from what the schedule wants.
    """
    if not X.HA.connected:
        return [], "not connected to Home Assistant"
    entity_id = schedule["entity_id"]
    st = X.HA.states.get(entity_id)
    if not st or st.get("state") in ("unavailable", "unknown"):
        return [], "entity unavailable"

    hvac_state = st.get("state")
    target = _num((st.get("attributes") or {}).get("temperature"))
    actions = []

    async def _ensure_temp(temp, why):
        if hvac_state == "off":
            await X.HA.call_service("climate", "turn_on",
                                    target={"entity_id": entity_id})
            actions.append({"action": "turn_on", "detail": why})
        if (hvac_state == "off" or target is None
                or abs(target - temp) > TEMP_EPS):
            await X.HA.call_service("climate", "set_temperature",
                                    {"temperature": temp},
                                    target={"entity_id": entity_id})
            actions.append({"action": "set_temperature",
                            "detail": f"{temp}° — {why}"})

    block = _current_block(schedule, datetime.now())
    if block is not None:
        await _ensure_temp(float(block["temp"]),
                           f"block {block['from']}–{block['to']}")
    else:
        mode = schedule.get("outside", "off")
        if mode == "off":
            if hvac_state != "off":
                await X.HA.call_service("climate", "turn_off",
                                        target={"entity_id": entity_id})
                actions.append({"action": "turn_off",
                                "detail": "outside all blocks"})
        elif mode == "temp":
            await _ensure_temp(float(schedule.get("outside_temp", 17.0)),
                               "outside all blocks (fallback)")
        # mode == "nothing" -> leave the entity alone
    return actions, None


async def _commit_actions(entity_id, actions):
    if not actions:
        return
    async with _LOCK:
        for act in actions:
            _append_log(entity_id, act["action"], act["detail"])
        _save()


async def _loop():
    X.log.info("Climate Scheduler: enforcement loop running every %ss",
               LOOP_SECONDS)
    while True:
        try:
            for sid in list(_STATE["schedules"]):
                schedule = _STATE["schedules"].get(sid)
                if not schedule or not schedule.get("enabled"):
                    continue
                try:
                    actions, _skip = await _enforce(schedule)
                    await _commit_actions(schedule["entity_id"], actions)
                except Exception as exc:
                    X.log.warning("Climate Scheduler: enforcing %r failed: %s",
                                  sid, exc)
        except asyncio.CancelledError:
            raise
        except Exception:
            X.log.exception("Climate Scheduler: loop error")
        await asyncio.sleep(LOOP_SECONDS)


async def _startup(app):
    app["climate_scheduler_task"] = asyncio.create_task(_loop())


async def _cleanup(app):
    task = app.get("climate_scheduler_task")
    if task:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await task

# ---------------------------------------------------------------- pages


async def page_tool(request):
    if not X.is_admin(request):
        raise web.HTTPFound("/?d=__admin__")
    return web.FileResponse(TOOL_DIR / "static" / "index.html")

# ---------------------------------------------------------------- API


async def api_data(request):
    X.require_admin(request)
    climates = []
    for entity_id, st in sorted(X.HA.states.items()):
        if not entity_id.startswith("climate."):
            continue
        attrs = st.get("attributes") or {}
        climates.append({
            "entity_id": entity_id,
            "name": attrs.get("friendly_name") or entity_id,
            "state": st.get("state"),
            "current_temperature": attrs.get("current_temperature"),
            "temperature": attrs.get("temperature"),
            "min_temp": attrs.get("min_temp"),
            "max_temp": attrs.get("max_temp"),
            "target_temp_step": attrs.get("target_temp_step"),
            "hvac_modes": attrs.get("hvac_modes") or [],
        })
    return web.json_response({
        "connected": X.HA.connected,
        "schedules": _STATE["schedules"],
        "climates": climates,
        "log": _STATE["log"],
    })


async def api_save(request):
    X.require_admin(request)
    try:
        body = await request.json()
    except Exception:
        return _err("invalid JSON body", 400)
    clean, error = _validate(body.get("schedule") or {})
    if error:
        return _err(error, 400)
    sid = str(body.get("sid") or "").strip()
    async with _LOCK:
        if sid and sid not in _STATE["schedules"]:
            return _err("schedule not found", 404)
        if not sid:
            sid = uuid.uuid4().hex[:10]
        _STATE["schedules"][sid] = clean
        _save()
    return web.json_response({"ok": True, "sid": sid, "schedule": clean})


async def api_delete(request):
    X.require_admin(request)
    sid = request.match_info["sid"]
    async with _LOCK:
        if sid not in _STATE["schedules"]:
            return _err("schedule not found", 404)
        _STATE["schedules"].pop(sid)
        _save()
    return web.json_response({"ok": True})


async def api_enable(request):
    X.require_admin(request)
    sid = request.match_info["sid"]
    try:
        body = await request.json()
    except Exception:
        return _err("invalid JSON body", 400)
    async with _LOCK:
        schedule = _STATE["schedules"].get(sid)
        if not schedule:
            return _err("schedule not found", 404)
        schedule["enabled"] = bool(body.get("enabled"))
        _save()
    return web.json_response({"ok": True, "enabled": schedule["enabled"]})


async def api_apply(request):
    """Run the enforcement for one schedule immediately."""
    X.require_admin(request)
    sid = request.match_info["sid"]
    schedule = _STATE["schedules"].get(sid)
    if not schedule:
        return _err("schedule not found", 404)
    try:
        actions, skipped = await _enforce(schedule)
    except Exception as exc:
        return _err(exc)
    await _commit_actions(schedule["entity_id"], actions)
    return web.json_response({"ok": True, "actions": actions,
                              "skipped": skipped})

# ---------------------------------------------------------------- register


def register(app, ctx, manifest):
    global X
    X = ctx
    _load()

    base = "/api/tools/climate_scheduler"
    app.router.add_get("/tools/climate_scheduler/", page_tool)

    app.router.add_get(f"{base}/data", api_data)
    app.router.add_post(f"{base}/schedule", api_save)
    app.router.add_delete(f"{base}/schedule/{{sid}}", api_delete)
    app.router.add_post(f"{base}/schedule/{{sid}}/enable", api_enable)
    app.router.add_post(f"{base}/schedule/{{sid}}/apply", api_apply)

    app.on_startup.append(_startup)
    app.on_cleanup.append(_cleanup)
