"""Entity Doctor — Advance Tools plugin.

Full health check-up for the entity registry:

* Scans every entity and groups problems into categories: unavailable,
  unknown state, low battery, orphaned (restored / device gone / never
  loaded), stale (no state change for N days), duplicate friendly names,
  plus informational lists (disabled, hidden, devices without an area).
* One-click fixes through HA's entity-registry WebSocket API: rename
  (friendly name and/or entity_id), hide, disable, enable, and remove
  orphaned registry entries — single or in bulk.
* A usage finder (HA's search/related API) shows where an entity is used
  before you hide, disable or remove it.
* Dead-device detection: devices whose entities are ALL unavailable/unknown/
  restored (or that have no entities at all) are listed separately and can be
  removed in one shot — config entries are detached and leftover registry
  entities cleaned up.
* Every removal (entity or device) is appended to a deletion log in /data so
  there is always a record of what was deleted and when.
"""
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path

import aiohttp
from aiohttp import web

X = None  # core context, injected by the loader
TOOL_DIR = Path(__file__).parent

CORE_API = "http://supervisor/core/api"

DEFAULT_BATTERY = 20        # percent — at or below this is "low"
DEFAULT_STALE_DAYS = 7      # no state change for this many days is "stale"

ENTITY_ID_RE = re.compile(r"^[a-z0-9_]+\.[a-z0-9_]+$")

# Domains where "hasn't changed in days" is normal, not a problem.
STALE_EXEMPT = {
    "automation", "script", "scene", "button", "input_button", "zone",
    "person", "device_tracker", "tag", "tts", "stt", "conversation",
    "update", "remote", "calendar", "schedule", "input_boolean",
    "input_number", "input_text", "input_select", "input_datetime",
    "counter", "timer", "group", "todo", "select", "number", "text",
    "siren", "lock", "alarm_control_panel", "vacuum", "lawn_mower",
    "water_heater", "camera", "image", "wake_word", "assist_satellite",
    "ai_task", "notify", "event", "date", "time", "datetime",
}

# Bulk actions -> entity_registry/update payload (None removes the flag).
BULK_ACTIONS = {
    "hide":    {"hidden_by": "user"},
    "unhide":  {"hidden_by": None},
    "disable": {"disabled_by": "user"},
    "enable":  {"disabled_by": None},
}


def _err(exc_or_msg, status=502):
    return web.json_response({"error": str(exc_or_msg)}, status=status)


# ------------------------------------------------------------- deletion log

TRASH_FILE = "entity_doctor_trash.jsonl"


def _trash_path():
    return Path(X.DATA) / TRASH_FILE


def _log_trash(kind, payload):
    """Append one deletion record to the log. Never raises."""
    try:
        rec = {"ts": time.time(), "kind": kind}
        rec.update(payload)
        with _trash_path().open("a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except Exception:
        log_exc = getattr(X, "log", None)
        if log_exc:
            log_exc.exception("entity_doctor: could not write deletion log")


def _state_name(eid):
    st = X.HA.states.get(eid) or {}
    return (st.get("attributes") or {}).get("friendly_name") or eid


def _parse_ts(value):
    """ISO timestamp -> unix seconds, or None."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")) \
                       .astimezone(timezone.utc).timestamp()
    except ValueError:
        return None


def _num(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None

# ---------------------------------------------------------------- pages

async def page_tool(request):
    if not X.is_admin(request):
        raise web.HTTPFound("/?d=__admin__")
    return web.FileResponse(TOOL_DIR / "static" / "index.html")

# ---------------------------------------------------------------- scan

async def _registries():
    """Entity/device/area registries in one round of WS calls."""
    entities = await X.HA.ws_call({"type": "config/entity_registry/list"})
    devices = await X.HA.ws_call({"type": "config/device_registry/list"})
    try:
        areas = await X.HA.ws_call({"type": "config/area_registry/list"})
    except Exception:
        areas = []
    return entities or [], devices or [], areas or []


def _display_name(reg, attrs, eid):
    if reg:
        if reg.get("name"):
            return reg["name"]
        if reg.get("original_name"):
            return reg["original_name"]
    return (attrs or {}).get("friendly_name") or eid


async def _scan_data(battery_th, stale_days):
    """Run the full check-up. Returns the scan dict (shared by scan + repair)."""
    reg_list, dev_list, area_list = await _registries()

    states = X.HA.states
    regs = {e["entity_id"]: e for e in reg_list if e.get("entity_id")}
    devices = {d["id"]: d for d in dev_list if d.get("id")}
    areas = {a["area_id"]: a.get("name") or a["area_id"]
             for a in area_list if a.get("area_id")}

    now = time.time()
    stale_before = now - stale_days * 86400

    issues = {k: [] for k in ("unavailable", "unknown", "battery", "orphaned",
                              "stale", "duplicate", "disabled", "hidden",
                              "no_area")}
    problem_ids = set()      # entities counted against the health score
    name_groups = {}         # lowercased friendly name -> [item]

    all_ids = set(states) | set(regs)
    total_active = 0

    for eid in sorted(all_ids):
        st = states.get(eid)
        reg = regs.get(eid)
        attrs = (st or {}).get("attributes") or {}
        state = (st or {}).get("state")
        domain = eid.split(".")[0]

        disabled = bool(reg and reg.get("disabled_by"))
        hidden = bool(reg and reg.get("hidden_by"))
        device = devices.get(reg.get("device_id")) if reg else None
        device_gone = bool(reg and reg.get("device_id") and device is None)
        area_id = (reg.get("area_id") if reg else None) or \
                  (device.get("area_id") if device else None)
        restored = attrs.get("restored") is True

        item = {
            "entity_id": eid,
            "name": _display_name(reg, attrs, eid),
            "domain": domain,
            "state": state,
            "platform": reg.get("platform") if reg else None,
            "device": (device.get("name_by_user") or device.get("name"))
                      if device else None,
            "area": areas.get(area_id),
            "last_changed": (st or {}).get("last_changed"),
            "registry": bool(reg),
            "disabled": disabled,
            "hidden": hidden,
            "config_entry_id": reg.get("config_entry_id") if reg else None,
        }

        if disabled:
            issues["disabled"].append(dict(item, detail=reg.get("disabled_by")))
            continue                      # a disabled entity has no state anyway
        total_active += 1

        if hidden:
            issues["hidden"].append(dict(item, detail=reg.get("hidden_by")))

        if reg and reg.get("device_id") and device and area_id is None:
            issues["no_area"].append(dict(
                item, detail="its device has no area assigned"))

        # ---- orphaned (worst first: takes over from plain "unavailable")
        if restored:
            issues["orphaned"].append(dict(
                item, detail="restored — its integration no longer provides it"))
            problem_ids.add(eid)
        elif device_gone:
            issues["orphaned"].append(dict(
                item, detail="its device was removed from the device registry"))
            problem_ids.add(eid)
        elif reg and st is None:
            issues["orphaned"].append(dict(
                item, detail="registered but never loaded (no state)"))
            problem_ids.add(eid)
        # ---- unavailable / unknown
        elif state == "unavailable":
            issues["unavailable"].append(dict(item, detail=item["platform"] or ""))
            problem_ids.add(eid)
        elif state == "unknown":
            issues["unknown"].append(dict(item, detail=item["platform"] or ""))
            problem_ids.add(eid)
        else:
            # ---- low battery (only for entities that are alive)
            level = None
            if attrs.get("device_class") == "battery":
                if domain == "sensor":
                    level = _num(state)
                elif domain == "binary_sensor" and state == "on":
                    level = -1            # binary "battery low" fired
            if level is None:
                level = _num(attrs.get("battery_level"))
                if level is not None and level > battery_th:
                    level = None
            if level is not None and level <= battery_th:
                detail = ("battery-low signal" if level < 0
                          else f"{level:g}% battery")
                issues["battery"].append(dict(item, detail=detail,
                                              level=max(level, 0)))
                problem_ids.add(eid)

            # ---- stale
            ts = _parse_ts(item["last_changed"])
            if (domain not in STALE_EXEMPT and ts is not None
                    and ts < stale_before):
                days = (now - ts) / 86400
                issues["stale"].append(dict(
                    item, detail=f"no change for {days:.0f} days", days=round(days)))
                problem_ids.add(eid)

        # ---- duplicate friendly names (across everything not disabled)
        key = str(item["name"]).strip().lower()
        if key and key != eid:
            name_groups.setdefault(key, []).append(item)

    for key, group in sorted(name_groups.items()):
        if len(group) > 1:
            for it in group:
                issues["duplicate"].append(dict(
                    it, detail=f'"{group[0]["name"]}" used by {len(group)} entities',
                    dupes=[g["entity_id"] for g in group]))

    issues["battery"].sort(key=lambda i: i.get("level", 0))
    issues["stale"].sort(key=lambda i: -i.get("days", 0))

    dead_devices = _find_dead_devices(reg_list, devices, areas, states, now)

    healthy = max(total_active - len(problem_ids), 0)
    score = round(100 * healthy / total_active) if total_active else 100

    summary = {k: len(v) for k, v in issues.items()}
    summary["dead_device"] = len(dead_devices)

    return {
        "connected": True,
        "generated": now,
        "total": len(all_ids),
        "active": total_active,
        "problems": len(problem_ids),
        "score": score,
        "battery_threshold": battery_th,
        "stale_days": stale_days,
        "summary": summary,
        "issues": issues,
        "dead_devices": dead_devices,
    }


def _find_dead_devices(reg_list, devices, areas, states, now):
    """Devices where every enabled entity is unavailable/unknown/restored/
    never-loaded, plus devices with no entities at all. A device with only
    disabled entities is considered deliberate and skipped."""
    by_device = {}
    for reg in reg_list:
        did = reg.get("device_id")
        if did:
            by_device.setdefault(did, []).append(reg)

    def _entity_dead(reg):
        """(is_dead, died_ts_or_None)"""
        st = states.get(reg["entity_id"])
        if st is None:
            return True, None                       # registered, never loaded
        if (st.get("attributes") or {}).get("restored") is True:
            return True, _parse_ts(st.get("last_changed"))
        if st.get("state") in ("unavailable", "unknown"):
            return True, _parse_ts(st.get("last_changed"))
        return False, None

    dead = []
    for did, dev in devices.items():
        if dev.get("disabled_by"):
            continue
        ents = by_device.get(did, [])
        enabled = [r for r in ents if not r.get("disabled_by")]

        reason, since = None, None
        if enabled:
            flags = [_entity_dead(r) for r in enabled]
            if all(f for f, _ in flags):
                stamps = [t for _, t in flags if t]
                since = max(stamps) if stamps else None
                n = len(enabled)
                reason = (f"all {n} entities are dead" if n > 1
                          else "its only entity is dead")
        elif not ents:
            reason = "no entities at all (empty registry entry)"
        if not reason:
            continue

        dead.append({
            "device_id": did,
            "name": dev.get("name_by_user") or dev.get("name") or did,
            "manufacturer": dev.get("manufacturer") or "",
            "model": dev.get("model") or "",
            "area": areas.get(dev.get("area_id")),
            "integration": next((r.get("platform") for r in ents
                                 if r.get("platform")), None),
            "config_entries": dev.get("config_entries") or [],
            "reason": reason,
            "since_days": (round((now - since) / 86400, 1)
                           if since else None),
            "entities": [{
                "entity_id": r["entity_id"],
                "name": _display_name(
                    r, (states.get(r["entity_id"]) or {}).get("attributes"),
                    r["entity_id"]),
                "state": (states.get(r["entity_id"]) or {}).get("state"),
                "disabled": bool(r.get("disabled_by")),
            } for r in sorted(ents, key=lambda r: r["entity_id"])],
        })
    dead.sort(key=lambda d: -(d["since_days"] or 0))
    return dead


def _thresholds(request):
    battery_th = float(request.query.get("battery", DEFAULT_BATTERY))
    stale_days = float(request.query.get("stale_days", DEFAULT_STALE_DAYS))
    return battery_th, stale_days


async def api_scan(request):
    """Run the full check-up and return categorized issues."""
    X.require_admin(request)
    if not X.HA.connected:
        return web.json_response({"connected": False})
    try:
        battery_th, stale_days = _thresholds(request)
    except ValueError:
        return _err("battery and stale_days must be numbers", 400)
    try:
        data = await _scan_data(battery_th, stale_days)
    except Exception as exc:
        return _err(exc)
    return web.json_response(data)

# ---------------------------------------------------------------- fixes

async def api_update(request):
    """Rename / hide / disable a single entity through the registry."""
    X.require_admin(request)
    body = await request.json()
    eid = str(body.get("entity_id", ""))
    if not ENTITY_ID_RE.match(eid):
        return _err("invalid entity_id", 400)

    msg = {"type": "config/entity_registry/update", "entity_id": eid}
    if "name" in body:
        name = body["name"]
        msg["name"] = str(name).strip() or None    # empty -> back to original
    if body.get("new_entity_id"):
        new_eid = str(body["new_entity_id"]).strip().lower()
        if not ENTITY_ID_RE.match(new_eid):
            return _err("new_entity_id must look like domain.object_id", 400)
        if new_eid.split(".")[0] != eid.split(".")[0]:
            return _err("new_entity_id must keep the same domain", 400)
        if new_eid != eid:
            msg["new_entity_id"] = new_eid
    if "hidden" in body:
        msg["hidden_by"] = "user" if body["hidden"] else None
    if "disabled" in body:
        msg["disabled_by"] = "user" if body["disabled"] else None

    if len(msg) <= 2:
        return _err("nothing to change", 400)
    try:
        result = await X.HA.ws_call(msg)
    except Exception as exc:
        return _err(exc)
    entry = (result or {}).get("entity_entry") or result or {}
    return web.json_response({"ok": True,
                              "entity_id": entry.get("entity_id", eid),
                              "require_restart": bool(
                                  (result or {}).get("require_restart"))})


def _orphan_ok(eid):
    """True when an entity is safe to delete from the registry."""
    st = X.HA.states.get(eid)
    attrs = (st or {}).get("attributes") or {}
    return st is None or attrs.get("restored") is True


async def api_remove(request):
    """Delete an orphaned entity from the registry (guarded server-side)."""
    X.require_admin(request)
    body = await request.json()
    eid = str(body.get("entity_id", ""))
    if not ENTITY_ID_RE.match(eid):
        return _err("invalid entity_id", 400)

    if not _orphan_ok(eid):
        return _err("refusing to remove: entity is still provided by its "
                    "integration — disable or hide it instead", 400)
    name = _state_name(eid)
    try:
        await X.HA.ws_call({"type": "config/entity_registry/remove",
                            "entity_id": eid})
    except Exception as exc:
        return _err(exc)
    _log_trash("entity", {"entity_id": eid, "name": name, "via": "single"})
    return web.json_response({"ok": True})


async def api_bulk(request):
    """Apply hide/unhide/disable/enable/remove to many entities at once."""
    X.require_admin(request)
    body = await request.json()
    action = str(body.get("action", ""))
    ids = body.get("entity_ids") or []
    if action not in BULK_ACTIONS and action != "remove":
        return _err("unknown action", 400)
    if not isinstance(ids, list) or not ids:
        return _err("entity_ids required", 400)
    if len(ids) > 500:
        return _err("too many entities in one call (max 500)", 400)

    done, errors = [], []
    for eid in ids:
        eid = str(eid)
        if not ENTITY_ID_RE.match(eid):
            errors.append({"entity_id": eid, "error": "invalid entity_id"})
            continue
        try:
            if action == "remove":
                if not _orphan_ok(eid):
                    raise RuntimeError("not orphaned — skipped")
                name = _state_name(eid)
                await X.HA.ws_call({"type": "config/entity_registry/remove",
                                    "entity_id": eid})
                _log_trash("entity", {"entity_id": eid, "name": name,
                                      "via": "bulk"})
            else:
                await X.HA.ws_call({"type": "config/entity_registry/update",
                                    "entity_id": eid, **BULK_ACTIONS[action]})
            done.append(eid)
        except Exception as exc:
            errors.append({"entity_id": eid, "error": str(exc)})
    return web.json_response({"ok": not errors, "done": done, "errors": errors})

# ---------------------------------------------------------------- safe repair

async def _core_rest(method, path, payload=None):
    """Call HA Core REST API through the Supervisor proxy."""
    if not X.SUPERVISOR_TOKEN:
        raise web.HTTPServiceUnavailable(text="no HA connection")
    headers = {"Authorization": f"Bearer {X.SUPERVISOR_TOKEN}",
               "Content-Type": "application/json"}
    async with aiohttp.ClientSession() as s:
        async with s.request(method, CORE_API + path, headers=headers,
                             json=payload,
                             timeout=aiohttp.ClientTimeout(total=30)) as r:
            text = await r.text()
            try:
                data = json.loads(text) if text else {}
            except ValueError:
                data = {"raw": text}
            return r.status, data


def _dupe_groups(items):
    """Rebuild duplicate groups from the flat issue list."""
    groups = {}
    for it in items:
        key = tuple(sorted(it.get("dupes") or [it["entity_id"]]))
        groups.setdefault(key, []).append(it)
    return list(groups.values())


def _plan_duplicates(items):
    """Safe plan for a duplicate-names group: keep the healthy entity,
    rename living twins apart (by area/device), drop dead leftovers."""
    actions = []
    for group in _dupe_groups(items):
        name = group[0]["name"]
        alive = [it for it in group
                 if it["state"] not in (None, "unavailable", "unknown")
                 and not it["disabled"]]
        dead = [it for it in group if it not in alive]

        if len(alive) >= 2:
            # Different real entities sharing one name — rename, delete nothing.
            used = set()
            for it in alive:
                if not it.get("registry"):
                    actions.append({
                        "op": "keep", "entity_id": it["entity_id"],
                        "name": name,
                        "reason": "not in the entity registry (YAML-defined) "
                                  "— rename it in its YAML config instead",
                        "checked": False,
                    })
                    continue
                prefix = it.get("area") or it.get("device")
                new_name = None
                if prefix and prefix.lower() not in str(name).lower():
                    new_name = f"{prefix} {name}"
                if not new_name or new_name.lower() in used:
                    plat = it.get("platform")
                    if plat:
                        new_name = f"{name} ({plat})"
                if not new_name or new_name.lower() in used:
                    new_name = f"{name} ({it['entity_id'].split('.', 1)[1]})"
                used.add(new_name.lower())
                actions.append({
                    "op": "rename", "entity_id": it["entity_id"],
                    "name": name, "new_name": new_name,
                    "reason": "two or more living entities share this name — "
                              "renaming keeps both and makes them distinct",
                    "checked": bool(it.get("area") or it.get("device")),
                })
        elif len(alive) == 1:
            actions.append({
                "op": "keep", "entity_id": alive[0]["entity_id"],
                "name": name,
                "reason": "healthy — this one is kept unchanged",
                "checked": False,
            })

        for it in dead:
            if _orphan_ok(it["entity_id"]):
                actions.append({
                    "op": "remove", "entity_id": it["entity_id"], "name": name,
                    "reason": "dead leftover (orphaned) sharing the name of a "
                              "healthy entity",
                    "checked": True,
                })
            else:
                actions.append({
                    "op": "hide", "entity_id": it["entity_id"], "name": name,
                    "reason": f"currently {it['state'] or 'not loaded'} but "
                              "still provided by its integration — hidden, "
                              "not deleted (it may come back)",
                    "checked": True,
                })
    return actions


def _plan_orphans(items):
    return [{
        "op": "remove", "entity_id": it["entity_id"], "name": it["name"],
        "reason": it.get("detail") or "orphaned registry entry",
        "checked": True,
    } for it in items if _orphan_ok(it["entity_id"])]


def _plan_reload(items, category):
    """Group unavailable/unknown entities by integration -> one reload each."""
    by_entry, no_entry = {}, []
    for it in items:
        if it.get("config_entry_id"):
            by_entry.setdefault(it["config_entry_id"], []).append(it)
        else:
            no_entry.append(it)
    actions = []
    for entry_id, group in sorted(by_entry.items(),
                                  key=lambda kv: -len(kv[1])):
        plat = group[0].get("platform") or "integration"
        actions.append({
            "op": "reload", "entry_id": entry_id, "platform": plat,
            "name": f"Reload {plat}",
            "entities": [g["entity_id"] for g in group],
            "reason": f"{len(group)} {category} entit"
                      f"{'y' if len(group) == 1 else 'ies'} from this "
                      "integration — reloading often brings them back",
            "checked": True,
        })
    for it in no_entry:
        actions.append({
            "op": "keep", "entity_id": it["entity_id"], "name": it["name"],
            "reason": "no config entry (YAML/template platform) — cannot be "
                      "reloaded automatically",
            "checked": False,
        })
    return actions


REPAIRABLE = {"duplicate", "orphaned", "unavailable", "unknown"}


async def api_repair_plan(request):
    """Compute a safe, previewable repair plan for one category."""
    X.require_admin(request)
    if not X.HA.connected:
        return _err("not connected to Home Assistant", 503)
    category = request.query.get("category", "")
    if category not in REPAIRABLE:
        return _err("category must be one of: " + ", ".join(sorted(REPAIRABLE)),
                    400)
    try:
        battery_th, stale_days = _thresholds(request)
    except ValueError:
        return _err("battery and stale_days must be numbers", 400)
    try:
        data = await _scan_data(battery_th, stale_days)
    except Exception as exc:
        return _err(exc)

    items = data["issues"][category]
    if category == "duplicate":
        actions = _plan_duplicates(items)
    elif category == "orphaned":
        actions = _plan_orphans(items)
    else:
        actions = _plan_reload(items, category)
    doable = [a for a in actions if a["op"] not in ("keep",)]
    return web.json_response({"category": category, "actions": actions,
                              "doable": len(doable)})


async def api_repair_apply(request):
    """Apply user-approved repair actions (same guards as single fixes)."""
    X.require_admin(request)
    body = await request.json()
    actions = body.get("actions") or []
    if not isinstance(actions, list) or not actions:
        return _err("actions required", 400)
    if len(actions) > 200:
        return _err("too many actions in one call (max 200)", 400)

    done, errors = [], []
    for act in actions:
        op = str(act.get("op", ""))
        eid = str(act.get("entity_id", ""))
        label = eid or str(act.get("entry_id", ""))
        try:
            if op == "rename":
                if not ENTITY_ID_RE.match(eid):
                    raise RuntimeError("invalid entity_id")
                new_name = str(act.get("new_name", "")).strip()
                if not new_name:
                    raise RuntimeError("new_name required")
                await X.HA.ws_call({"type": "config/entity_registry/update",
                                    "entity_id": eid, "name": new_name})
            elif op == "hide":
                if not ENTITY_ID_RE.match(eid):
                    raise RuntimeError("invalid entity_id")
                await X.HA.ws_call({"type": "config/entity_registry/update",
                                    "entity_id": eid, "hidden_by": "user"})
            elif op == "remove":
                if not ENTITY_ID_RE.match(eid):
                    raise RuntimeError("invalid entity_id")
                if not _orphan_ok(eid):
                    raise RuntimeError("not orphaned — skipped")
                name = _state_name(eid)
                await X.HA.ws_call({"type": "config/entity_registry/remove",
                                    "entity_id": eid})
                _log_trash("entity", {"entity_id": eid, "name": name,
                                      "via": "repair"})
            elif op == "reload":
                entry_id = str(act.get("entry_id", ""))
                if not re.match(r"^[0-9A-Za-z]{10,64}$", entry_id):
                    raise RuntimeError("invalid entry_id")
                status, data = await _core_rest(
                    "POST", f"/config/config_entries/entry/{entry_id}/reload")
                if status != 200:
                    raise RuntimeError(data.get("message") or f"HTTP {status}")
            else:
                raise RuntimeError(f"unknown op {op!r}")
            done.append({"op": op, "id": label})
        except Exception as exc:
            errors.append({"op": op, "id": label, "error": str(exc)})
    return web.json_response({"ok": not errors, "done": done,
                              "errors": errors})

# ---------------------------------------------------------------- devices

DEVICE_ID_RE = re.compile(r"^[0-9a-f]{32}$")


async def api_device_remove(request):
    """Remove dead devices: detach every config entry from the device (HA's
    own deletion mechanism), then clean up leftover orphaned registry
    entities. Guarded: refuses devices that still have living entities."""
    X.require_admin(request)
    body = await request.json()
    ids = body.get("device_ids") or []
    if body.get("device_id"):
        ids = [body["device_id"]]
    if not isinstance(ids, list) or not ids:
        return _err("device_ids required", 400)
    if len(ids) > 50:
        return _err("too many devices in one call (max 50)", 400)

    try:
        dev_list = await X.HA.ws_call({"type": "config/device_registry/list"})
        ent_list = await X.HA.ws_call({"type": "config/entity_registry/list"})
    except Exception as exc:
        return _err(exc)
    devices = {d["id"]: d for d in dev_list or []}
    by_device = {}
    for e in ent_list or []:
        if e.get("device_id"):
            by_device.setdefault(e["device_id"], []).append(e)

    def _device_alive(did):
        for reg in by_device.get(did, []):
            if reg.get("disabled_by"):
                continue
            st = X.HA.states.get(reg["entity_id"])
            if st is None:
                continue
            if (st.get("attributes") or {}).get("restored") is True:
                continue
            if st.get("state") not in ("unavailable", "unknown"):
                return True
        return False

    results = []
    for did in ids:
        did = str(did)
        if not DEVICE_ID_RE.match(did):
            results.append({"device_id": did, "ok": False,
                            "error": "invalid device_id"})
            continue
        dev = devices.get(did)
        if not dev:
            results.append({"device_id": did, "ok": False,
                            "error": "device not found"})
            continue
        name = dev.get("name_by_user") or dev.get("name") or did
        if _device_alive(did):
            results.append({"device_id": did, "name": name, "ok": False,
                            "error": "refusing to remove: this device still "
                                     "has at least one living entity"})
            continue

        errors, removed_entities = [], []
        for entry_id in dev.get("config_entries") or []:
            try:
                await X.HA.ws_call({
                    "type": "config/device_registry/remove_config_entry",
                    "device_id": did, "config_entry_id": entry_id})
            except Exception as exc:
                errors.append(f"config entry {entry_id}: {exc}")
        for reg in by_device.get(did, []):
            eid = reg["entity_id"]
            if _orphan_ok(eid):
                try:
                    await X.HA.ws_call(
                        {"type": "config/entity_registry/remove",
                         "entity_id": eid})
                    removed_entities.append(eid)
                except Exception:
                    pass          # usually already gone with the device
        results.append({"device_id": did, "name": name,
                        "removed_entities": removed_entities,
                        "errors": errors})

    # One final registry read tells us which devices are actually gone.
    try:
        check = await X.HA.ws_call({"type": "config/device_registry/list"})
        still = {d["id"] for d in check or []}
    except Exception:
        still = None
    for r in results:
        if "error" in r and "ok" in r:
            continue
        gone = (r["device_id"] not in still) if still is not None else None
        r["gone"] = gone
        r["ok"] = bool(gone) and not r["errors"]
        if not r["ok"] and not r["errors"]:
            r["errors"] = ["the integration refused to release this device — "
                           "it may need to be removed from the integration's "
                           "own page (Settings → Devices & Services)"]
        _log_trash("device", {"device_id": r["device_id"], "name": r["name"],
                              "entities": r["removed_entities"],
                              "gone": gone, "errors": r["errors"]})
    return web.json_response(
        {"ok": all(r.get("ok") for r in results), "results": results})


async def api_trash(request):
    """The deletion log — newest first, capped at 300 records."""
    X.require_admin(request)
    items = []
    p = _trash_path()
    if p.exists():
        try:
            lines = p.read_text(encoding="utf-8").splitlines()[-300:]
        except Exception:
            lines = []
        for ln in lines:
            try:
                items.append(json.loads(ln))
            except ValueError:
                pass
    items.reverse()
    return web.json_response({"items": items})

# ---------------------------------------------------------------- usage finder

async def api_related(request):
    """Where is this entity used? (automations / scripts / scenes / groups)."""
    X.require_admin(request)
    eid = request.match_info["entity_id"]
    try:
        rel = await X.HA.ws_call({"type": "search/related",
                                  "item_type": "entity", "item_id": eid})
    except Exception as exc:
        return _err(exc)
    rel = rel or {}

    def _name(entity_id):
        st = X.HA.states.get(entity_id) or {}
        return (st.get("attributes") or {}).get("friendly_name") or entity_id

    out = {}
    for kind in ("automation", "script", "scene", "group", "entity"):
        ids = rel.get(kind) or []
        if kind == "entity":
            ids = [i for i in ids if i != eid]
        if ids:
            out[kind] = [{"id": i, "name": _name(i)} for i in sorted(ids)]
    return web.json_response({"related": out})

# ---------------------------------------------------------------- register

def register(app, ctx, manifest):
    global X
    X = ctx
    base = "/api/tools/entity_doctor"
    app.router.add_get("/tools/entity_doctor/", page_tool)

    app.router.add_get(f"{base}/scan", api_scan)
    app.router.add_post(f"{base}/update", api_update)
    app.router.add_post(f"{base}/remove", api_remove)
    app.router.add_post(f"{base}/bulk", api_bulk)
    app.router.add_get(f"{base}/repair/plan", api_repair_plan)
    app.router.add_post(f"{base}/repair/apply", api_repair_apply)
    app.router.add_post(f"{base}/devices/remove", api_device_remove)
    app.router.add_get(f"{base}/trash", api_trash)
    app.router.add_get(f"{base}/related/{{entity_id}}", api_related)
