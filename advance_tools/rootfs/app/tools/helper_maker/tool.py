"""Helper Maker — Advance Tools plugin.

Full management of Home Assistant helpers:

* Storage-collection helpers (input_boolean, input_number, input_text,
  input_select, input_datetime, input_button, counter, timer, schedule)
  get real create / update / delete through HA's WebSocket collection API.
* Config-entry helpers (group, template, threshold, derivative, integration,
  utility_meter, tod, trend, statistics, min_max, random, switch_as_x) are
  created and edited through HA's config-flow REST API, rendered dynamically
  on the frontend from the flow's data schema.
* A usage finder (HA's search/related API) shows which automations, scripts
  and scenes reference a helper before you change or delete it.
* Quick controls proxy safe service calls (toggle, set value, timer start…).
"""
import json
from pathlib import Path

import aiohttp
from aiohttp import web

X = None  # core context, injected by the loader
TOOL_DIR = Path(__file__).parent

CORE_API = "http://supervisor/core/api"

# Helper domains managed through the WS storage-collection API.
STORAGE_DOMAINS = (
    "input_boolean", "input_number", "input_text", "input_select",
    "input_datetime", "input_button", "counter", "timer", "schedule",
)

# Helper integrations created through a config flow. Order = display order.
FLOW_HANDLERS = (
    "group", "template", "threshold", "derivative", "integration",
    "utility_meter", "tod", "trend", "statistics", "min_max", "random",
    "switch_as_x",
)

# Service calls the quick controls are allowed to make.
ALLOWED_SERVICES = {
    ("input_boolean", "turn_on"), ("input_boolean", "turn_off"),
    ("input_boolean", "toggle"),
    ("input_button", "press"),
    ("input_number", "set_value"),
    ("input_text", "set_value"),
    ("input_select", "select_option"),
    ("input_datetime", "set_datetime"),
    ("counter", "increment"), ("counter", "decrement"),
    ("counter", "reset"), ("counter", "set_value"),
    ("timer", "start"), ("timer", "pause"), ("timer", "cancel"),
    ("timer", "finish"),
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
                             timeout=aiohttp.ClientTimeout(total=20)) as r:
            text = await r.text()
            try:
                data = json.loads(text) if text else {}
            except ValueError:
                data = {"raw": text}
            return r.status, data


def _err(exc_or_msg, status=502):
    return web.json_response({"error": str(exc_or_msg)}, status=status)


def _slim_state(st):
    return {"state": st.get("state"),
            "attributes": st.get("attributes") or {},
            "last_changed": st.get("last_changed")}

# ---------------------------------------------------------------- pages

async def page_tool(request):
    if not X.is_admin(request):
        raise web.HTTPFound("/?d=__admin__")
    return web.FileResponse(TOOL_DIR / "static" / "index.html")

# ---------------------------------------------------------------- list

async def api_helpers(request):
    """Everything in one call: storage items, config entries, entity map."""
    X.require_admin(request)
    if not X.HA.connected:
        return web.json_response({"connected": False, "storage": {},
                                  "entries": [], "states": {}})

    # entity registry: map storage unique_id / config_entry_id -> entity_id
    try:
        registry = await X.HA.ws_call({"type": "config/entity_registry/list"})
    except Exception as exc:
        return _err(exc)
    by_unique = {}     # (platform, unique_id) -> registry entry
    by_entry = {}      # config_entry_id -> [registry entries]
    for e in registry or []:
        plat = e.get("platform")
        uid = e.get("unique_id")
        if plat and uid is not None:
            by_unique[(plat, str(uid))] = e
        ceid = e.get("config_entry_id")
        if ceid:
            by_entry.setdefault(ceid, []).append(e)

    # storage-collection helpers
    storage = {}
    for domain in STORAGE_DOMAINS:
        try:
            items = await X.HA.ws_call({"type": f"{domain}/list"})
        except Exception:
            continue        # domain not loaded on this HA install
        out = []
        for it in items or []:
            reg = by_unique.get((domain, str(it.get("id"))))
            eid = reg["entity_id"] if reg else f"{domain}.{it.get('id')}"
            out.append({"config": it, "entity_id": eid,
                        "disabled": bool(reg and reg.get("disabled_by"))})
        storage[domain] = out

    # config-entry helpers
    entries = []
    try:
        raw = await X.HA.ws_call({"type": "config_entries/get",
                                  "type_filter": ["helper"]})
    except Exception:
        raw = []
    for en in raw or []:
        ents = by_entry.get(en.get("entry_id"), [])
        entries.append({
            "entry_id": en.get("entry_id"),
            "domain": en.get("domain"),
            "title": en.get("title"),
            "state": en.get("state"),
            "disabled_by": en.get("disabled_by"),
            "supports_options": en.get("supports_options", True),
            "entities": [{"entity_id": e["entity_id"],
                          "disabled": bool(e.get("disabled_by"))}
                         for e in ents],
        })

    # states for everything we listed
    wanted = {h["entity_id"] for lst in storage.values() for h in lst}
    for en in entries:
        wanted.update(e["entity_id"] for e in en["entities"])
    states = {eid: _slim_state(X.HA.states[eid])
              for eid in wanted if eid in X.HA.states}

    return web.json_response({"connected": True, "storage": storage,
                              "entries": entries, "states": states,
                              "flow_handlers": list(FLOW_HANDLERS)})


async def api_states(request):
    """Light poll endpoint: fresh states for the ids the page knows about."""
    X.require_admin(request)
    body = await request.json()
    ids = body.get("ids") or []
    states = {eid: _slim_state(X.HA.states[eid])
              for eid in ids if eid in X.HA.states}
    return web.json_response({"connected": X.HA.connected, "states": states})

# ---------------------------------------------------------------- storage CRUD

def _check_domain(domain):
    if domain not in STORAGE_DOMAINS:
        raise web.HTTPBadRequest(text="unknown helper domain")


async def api_storage_create(request):
    X.require_admin(request)
    domain = request.match_info["domain"]
    _check_domain(domain)
    cfg = await request.json()
    if not str(cfg.get("name", "")).strip():
        return _err("a name is required", 400)
    msg = {"type": f"{domain}/create", **cfg}
    try:
        item = await X.HA.ws_call(msg)
    except Exception as exc:
        return _err(exc)
    return web.json_response({"ok": True, "item": item})


async def api_storage_update(request):
    X.require_admin(request)
    domain = request.match_info["domain"]
    _check_domain(domain)
    item_id = request.match_info["item_id"]
    cfg = await request.json()
    cfg.pop("id", None)
    msg = {"type": f"{domain}/update", f"{domain}_id": item_id, **cfg}
    try:
        item = await X.HA.ws_call(msg)
    except Exception as exc:
        return _err(exc)
    return web.json_response({"ok": True, "item": item})


async def api_storage_delete(request):
    X.require_admin(request)
    domain = request.match_info["domain"]
    _check_domain(domain)
    item_id = request.match_info["item_id"]
    try:
        await X.HA.ws_call({"type": f"{domain}/delete",
                            f"{domain}_id": item_id})
    except Exception as exc:
        return _err(exc)
    return web.json_response({"ok": True})

# ---------------------------------------------------------------- quick controls

async def api_service(request):
    """Safe service-call proxy for the quick controls."""
    X.require_admin(request)
    body = await request.json()
    domain = str(body.get("domain", ""))
    service = str(body.get("service", ""))
    entity_id = str(body.get("entity_id", ""))
    data = body.get("data") or {}
    if (domain, service) not in ALLOWED_SERVICES:
        return _err("service not allowed", 400)
    if not entity_id.startswith(domain + "."):
        return _err("entity does not match service domain", 400)
    if not isinstance(data, dict):
        return _err("data must be an object", 400)
    try:
        await X.HA.call_service(domain, service, data,
                                target={"entity_id": entity_id})
    except Exception as exc:
        return _err(exc)
    return web.json_response({"ok": True})

# ---------------------------------------------------------------- usage finder

async def api_related(request):
    """Where is this helper used? (automations / scripts / scenes / groups)."""
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

# ---------------------------------------------------------------- config flows

def _check_handler(handler):
    if handler not in FLOW_HANDLERS:
        raise web.HTTPBadRequest(text="unknown helper flow handler")


async def api_flow_start(request):
    X.require_admin(request)
    body = await request.json()
    handler = str(body.get("handler", ""))
    _check_handler(handler)
    status, data = await _core_rest(
        "POST", "/config/config_entries/flow",
        {"handler": handler, "show_advanced_options": True})
    if status not in (200, 201):
        return _err(data.get("message", f"HTTP {status}"), status)
    return web.json_response({"flow": data})


async def api_flow_step(request):
    X.require_admin(request)
    flow_id = request.match_info["flow_id"]
    user_input = await request.json()
    status, data = await _core_rest(
        "POST", f"/config/config_entries/flow/{flow_id}", user_input)
    if status not in (200, 201):
        return _err(data.get("message", f"HTTP {status}"), status)
    return web.json_response({"flow": data})


async def api_flow_abort(request):
    X.require_admin(request)
    flow_id = request.match_info["flow_id"]
    await _core_rest("DELETE", f"/config/config_entries/flow/{flow_id}")
    return web.json_response({"ok": True})


async def api_options_start(request):
    X.require_admin(request)
    body = await request.json()
    entry_id = str(body.get("entry_id", ""))
    if not entry_id:
        return _err("entry_id required", 400)
    status, data = await _core_rest(
        "POST", "/config/config_entries/options/flow",
        {"handler": entry_id, "show_advanced_options": True})
    if status not in (200, 201):
        return _err(data.get("message", f"HTTP {status}"), status)
    return web.json_response({"flow": data})


async def api_options_step(request):
    X.require_admin(request)
    flow_id = request.match_info["flow_id"]
    user_input = await request.json()
    status, data = await _core_rest(
        "POST", f"/config/config_entries/options/flow/{flow_id}", user_input)
    if status not in (200, 201):
        return _err(data.get("message", f"HTTP {status}"), status)
    return web.json_response({"flow": data})


async def api_options_abort(request):
    X.require_admin(request)
    flow_id = request.match_info["flow_id"]
    await _core_rest("DELETE",
                     f"/config/config_entries/options/flow/{flow_id}")
    return web.json_response({"ok": True})


async def api_entry_delete(request):
    X.require_admin(request)
    entry_id = request.match_info["entry_id"]
    status, data = await _core_rest(
        "DELETE", f"/config/config_entries/entry/{entry_id}")
    if status != 200:
        return _err(data.get("message", f"HTTP {status}"), status)
    return web.json_response({"ok": True})


async def api_entry_disable(request):
    X.require_admin(request)
    entry_id = request.match_info["entry_id"]
    body = await request.json()
    disabled = bool(body.get("disabled"))
    try:
        await X.HA.ws_call({"type": "config_entries/disable",
                            "entry_id": entry_id,
                            "disabled_by": "user" if disabled else None})
    except Exception as exc:
        return _err(exc)
    return web.json_response({"ok": True})

# ---------------------------------------------------------------- register

def register(app, ctx, manifest):
    global X
    X = ctx
    base = "/api/tools/helper_maker"
    app.router.add_get("/tools/helper_maker/", page_tool)

    app.router.add_get(f"{base}/helpers", api_helpers)
    app.router.add_post(f"{base}/states", api_states)

    app.router.add_post(f"{base}/storage/{{domain}}", api_storage_create)
    app.router.add_put(f"{base}/storage/{{domain}}/{{item_id}}",
                       api_storage_update)
    app.router.add_delete(f"{base}/storage/{{domain}}/{{item_id}}",
                          api_storage_delete)

    app.router.add_post(f"{base}/service", api_service)
    app.router.add_get(f"{base}/related/{{entity_id}}", api_related)

    app.router.add_post(f"{base}/flow", api_flow_start)
    app.router.add_post(f"{base}/flow/{{flow_id}}", api_flow_step)
    app.router.add_delete(f"{base}/flow/{{flow_id}}", api_flow_abort)
    app.router.add_post(f"{base}/options", api_options_start)
    app.router.add_post(f"{base}/options/{{flow_id}}", api_options_step)
    app.router.add_delete(f"{base}/options/{{flow_id}}", api_options_abort)
    app.router.add_delete(f"{base}/entry/{{entry_id}}", api_entry_delete)
    app.router.add_post(f"{base}/entry/{{entry_id}}/disable",
                        api_entry_disable)
