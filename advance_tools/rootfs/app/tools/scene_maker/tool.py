"""Scene Maker — Advance Tools plugin.

Create, edit, test and activate Home Assistant scenes. The key feature is
snapshotting: pick an area (or individual entities), capture how everything
is set right now (lights on/off + brightness/color, climate targets, cover
positions, …) and save that as a scene through HA's scene config API.

UI-created scenes (stored in scenes.yaml by HA) are fully editable; scenes
defined manually in configuration.yaml are listed activate-only, same as
Automation Maker's YAML handling.
"""
import json
import uuid
from pathlib import Path

import aiohttp
from aiohttp import web

X = None  # core context injected by the tool loader
TOOL_DIR = Path(__file__).parent

CORE_API = "http://supervisor/core/api"

# Domains that make sense inside a scene, and the state attributes worth
# capturing for each (mirrors what HA's reproduce_state can replay).
# Lights are handled separately because color needs color_mode logic.
CAPTURE_ATTRS = {
    "switch": [],
    "input_boolean": [],
    "lock": [],
    "siren": [],
    "fan": ["percentage", "preset_mode", "oscillating", "direction"],
    "cover": ["current_position", "current_tilt_position"],
    "climate": ["temperature", "target_temp_high", "target_temp_low",
                "fan_mode", "humidity", "swing_mode", "preset_mode"],
    "media_player": ["volume_level", "is_volume_muted", "source"],
    "humidifier": ["humidity", "mode"],
    "water_heater": ["temperature"],
    "vacuum": ["fan_speed"],
    "valve": ["current_position"],
    "number": [],
    "input_number": [],
    "select": [],
    "input_select": [],
    "text": [],
    "input_text": [],
}
SNAPSHOT_DOMAINS = {"light", *CAPTURE_ATTRS}

# light color attribute to keep, by color_mode
LIGHT_COLOR_ATTR = {
    "color_temp": "color_temp_kelvin",
    "hs": "hs_color",
    "rgb": "rgb_color",
    "rgbw": "rgbw_color",
    "rgbww": "rgbww_color",
    "xy": "xy_color",
}


def _headers():
    return {"Authorization": f"Bearer {X.SUPERVISOR_TOKEN}",
            "Content-Type": "application/json"}


async def _core_rest(method, path, payload=None):
    """Call HA Core REST API through the Supervisor proxy."""
    if not X.SUPERVISOR_TOKEN:
        raise web.HTTPServiceUnavailable(text="no HA connection")
    async with aiohttp.ClientSession() as s:
        async with s.request(method, CORE_API + path, headers=_headers(),
                             json=payload,
                             timeout=aiohttp.ClientTimeout(total=15)) as r:
            text = await r.text()
            try:
                data = json.loads(text) if text else {}
            except ValueError:
                data = {"raw": text}
            return r.status, data

# ---------------------------------------------------------------- snapshot

def _capture_light(state, attrs):
    """Snapshot a light: state, and when on also brightness/color/effect."""
    if state != "on":
        return "off"
    cap = {"state": "on"}
    if attrs.get("brightness") is not None:
        cap["brightness"] = attrs["brightness"]
    color_attr = LIGHT_COLOR_ATTR.get(attrs.get("color_mode"))
    if color_attr and attrs.get(color_attr) is not None:
        cap[color_attr] = attrs[color_attr]
    effect = attrs.get("effect")
    if effect and str(effect).lower() not in ("none", "off"):
        cap["effect"] = effect
    return cap


def _capture_entity(eid):
    """Build the scene entry for one entity from its live state.
    Returns None when the entity can't be part of a scene right now."""
    st = X.HA.states.get(eid)
    if not st:
        return None
    state = st.get("state")
    if state in (None, "", "unavailable", "unknown"):
        return None
    domain = eid.split(".", 1)[0]
    if domain not in SNAPSHOT_DOMAINS:
        return None
    attrs = st.get("attributes") or {}
    if domain == "light":
        return _capture_light(state, attrs)
    keep = {}
    for a in CAPTURE_ATTRS[domain]:
        if attrs.get(a) is not None:
            keep[a] = attrs[a]
    if not keep:
        return state
    keep["state"] = state
    return keep

# ---------------------------------------------------------------- pages

async def page_tool(request):
    if not X.is_admin(request):
        raise web.HTTPFound("/?d=__admin__")
    return web.FileResponse(TOOL_DIR / "static" / "index.html")

# ---------------------------------------------------------------- API

async def api_scenes(request):
    """All scene entities with metadata."""
    X.require_admin(request)
    items = []
    for eid, st in sorted(X.HA.states.items()):
        if not eid.startswith("scene."):
            continue
        attrs = st.get("attributes") or {}
        state = st.get("state")
        items.append({
            "entity_id": eid,
            "name": attrs.get("friendly_name") or eid.split(".", 1)[1],
            "icon": attrs.get("icon") or "",
            "entities": attrs.get("entity_id") or [],
            "id": attrs.get("id"),   # present -> editable via config API
            "last_activated": state if state not in ("unknown", "unavailable")
                              else None,
        })
    return web.json_response({"scenes": items, "connected": X.HA.connected})


async def api_areas(request):
    """Areas with their snapshotable entities (entity/device/area registry)."""
    X.require_admin(request)
    try:
        areas = await X.HA.ws_call({"type": "config/area_registry/list"})
        devices = await X.HA.ws_call({"type": "config/device_registry/list"})
        entities = await X.HA.ws_call({"type": "config/entity_registry/list"})
    except Exception as exc:
        return web.json_response({"error": str(exc)}, status=502)

    dev_area = {d["id"]: d.get("area_id") for d in (devices or [])}
    by_area = {}          # area_id -> [entity_id]
    unassigned = []
    for e in entities or []:
        eid = e.get("entity_id", "")
        if eid.split(".", 1)[0] not in SNAPSHOT_DOMAINS:
            continue
        if e.get("disabled_by") or eid not in X.HA.states:
            continue
        area = e.get("area_id") or dev_area.get(e.get("device_id"))
        (by_area.setdefault(area, []) if area else unassigned).append(eid)

    def slim(eid):
        st = X.HA.states.get(eid, {})
        attrs = st.get("attributes") or {}
        return {"id": eid,
                "name": attrs.get("friendly_name") or eid,
                "state": st.get("state"),
                "domain": eid.split(".", 1)[0]}

    out = [{"area_id": a["area_id"], "name": a["name"],
            "entities": [slim(e) for e in sorted(by_area.get(a["area_id"], []))]}
           for a in sorted(areas or [], key=lambda a: a["name"].lower())]
    out = [a for a in out if a["entities"]]
    if unassigned:
        out.append({"area_id": "", "name": "No area",
                    "entities": [slim(e) for e in sorted(unassigned)]})
    return web.json_response({"areas": out})


async def api_snapshot(request):
    """Capture the current state of the given entities as scene entries.
    Body: {entity_ids: [...]}. Returns {entities: {...}, skipped: [...]}."""
    X.require_admin(request)
    body = await request.json()
    ids = body.get("entity_ids")
    if not isinstance(ids, list) or not ids:
        return web.json_response({"error": "entity_ids list is required"},
                                 status=400)
    captured, skipped = {}, []
    for eid in ids:
        eid = str(eid)
        entry = _capture_entity(eid)
        if entry is None:
            skipped.append(eid)
        else:
            captured[eid] = entry
    return web.json_response({"entities": captured, "skipped": skipped})


async def api_get_config(request):
    """Fetch one scene's config (UI-store scenes only)."""
    X.require_admin(request)
    sid = request.match_info["sid"]
    status, data = await _core_rest("GET", f"/config/scene/config/{sid}")
    if status == 404:
        return web.json_response(
            {"error": "yaml_defined",
             "message": "This scene is defined in YAML (configuration.yaml), "
                        "so Home Assistant's config API cannot read or edit "
                        "it. You can still activate it."},
            status=404)
    if status != 200:
        return web.json_response({"error": data.get("message", f"HTTP {status}")},
                                 status=status)
    return web.json_response({"config": data})


async def api_save_config(request):
    """Create or update a scene. Body: {id?, config{name, entities, icon?}}."""
    X.require_admin(request)
    body = await request.json()
    cfg = body.get("config")
    if not isinstance(cfg, dict) or not str(cfg.get("name", "")).strip():
        return web.json_response({"error": "config with a name is required"},
                                 status=400)
    entities = cfg.get("entities")
    if not isinstance(entities, dict) or not entities:
        return web.json_response({"error": "at least one entity is required"},
                                 status=400)
    for eid in entities:
        if "." not in str(eid):
            return web.json_response({"error": f"invalid entity id: {eid}"},
                                     status=400)
    clean = {"name": str(cfg["name"]).strip(), "entities": entities}
    if str(cfg.get("icon", "")).strip():
        clean["icon"] = str(cfg["icon"]).strip()
    sid = str(body.get("id") or uuid.uuid4().hex)
    status, data = await _core_rest("POST", f"/config/scene/config/{sid}", clean)
    if status not in (200, 201):
        return web.json_response({"error": data.get("message", f"HTTP {status}")},
                                 status=status)
    return web.json_response({"ok": True, "id": sid})


async def api_delete_config(request):
    X.require_admin(request)
    sid = request.match_info["sid"]
    status, data = await _core_rest("DELETE", f"/config/scene/config/{sid}")
    if status != 200:
        return web.json_response({"error": data.get("message", f"HTTP {status}")},
                                 status=status)
    return web.json_response({"ok": True})


async def api_activate(request):
    """Activate a saved scene. Body: {entity_id, transition?}."""
    X.require_admin(request)
    body = await request.json()
    eid = str(body.get("entity_id", ""))
    if not eid.startswith("scene."):
        return web.json_response({"error": "bad request"}, status=400)
    data = {"entity_id": eid}
    try:
        transition = float(body.get("transition"))
        if transition > 0:
            data["transition"] = transition
    except (TypeError, ValueError):
        pass
    try:
        await X.HA.call_service("scene", "turn_on", data)
    except Exception as exc:
        return web.json_response({"error": str(exc)}, status=502)
    return web.json_response({"ok": True})


async def api_apply(request):
    """Test a scene definition live WITHOUT saving it (scene.apply).
    Body: {entities: {...}, transition?}."""
    X.require_admin(request)
    body = await request.json()
    entities = body.get("entities")
    if not isinstance(entities, dict) or not entities:
        return web.json_response({"error": "entities dict is required"},
                                 status=400)
    data = {"entities": entities}
    try:
        transition = float(body.get("transition"))
        if transition > 0:
            data["transition"] = transition
    except (TypeError, ValueError):
        pass
    try:
        await X.HA.call_service("scene", "apply", data)
    except Exception as exc:
        return web.json_response({"error": str(exc)}, status=502)
    return web.json_response({"ok": True})

# ---------------------------------------------------------------- register

def register(app, ctx, manifest):
    global X
    X = ctx
    base = "/api/tools/scene_maker"
    app.router.add_get("/tools/scene_maker/", page_tool)
    app.router.add_get(f"{base}/scenes", api_scenes)
    app.router.add_get(f"{base}/areas", api_areas)
    app.router.add_post(f"{base}/snapshot", api_snapshot)
    app.router.add_get(f"{base}/config/{{sid}}", api_get_config)
    app.router.add_post(f"{base}/config", api_save_config)
    app.router.add_delete(f"{base}/config/{{sid}}", api_delete_config)
    app.router.add_post(f"{base}/activate", api_activate)
    app.router.add_post(f"{base}/apply", api_apply)
