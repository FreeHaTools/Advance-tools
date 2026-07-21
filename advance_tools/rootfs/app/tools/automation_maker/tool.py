"""Automation Maker — Advance Tools plugin.

List / enable / disable / run Home Assistant automations and create or edit
them through HA's automation config API (UI-editable automations only —
YAML-defined ones are listed read-only).
"""
import asyncio
import json
import uuid
from pathlib import Path

import aiohttp
from aiohttp import web

try:
    import yaml  # provided by py3-yaml in the add-on image
except ImportError:            # pragma: no cover
    yaml = None

X = None  # core context
TOOL_DIR = Path(__file__).parent

# The HA config folder (read-only map in config.yaml). New-style mapping
# mounts at /homeassistant; keep /config as a fallback for older setups.
HA_CONFIG_DIRS = (Path("/homeassistant"), Path("/config"))
SKIP_DIRS = {".storage", ".cloud", ".git", "custom_components", "deps",
             "www", "tts", "image", "backups", "themes", "blueprints",
             "esphome", "node-red"}
# keys copied into the converted (UI-store) automation
ALLOWED_KEYS = {"alias", "description", "trigger", "triggers", "condition",
                "conditions", "action", "actions", "mode", "max",
                "max_exceeded", "variables", "trace", "initial_state"}

CORE_API = "http://supervisor/core/api"


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

# ---------------------------------------------------------------- pages

async def page_tool(request):
    if not X.is_admin(request):
        raise web.HTTPFound("/?d=__admin__")
    return web.FileResponse(TOOL_DIR / "static" / "index.html")

# ---------------------------------------------------------------- API

async def api_list(request):
    """All automation entities with state + metadata."""
    X.require_admin(request)
    items = []
    for eid, st in sorted(X.HA.states.items()):
        if not eid.startswith("automation."):
            continue
        attrs = st.get("attributes") or {}
        items.append({
            "entity_id": eid,
            "name": attrs.get("friendly_name") or eid.split(".", 1)[1],
            "state": st.get("state"),
            "last_triggered": attrs.get("last_triggered"),
            "id": attrs.get("id"),          # present → editable via config API
            "mode": attrs.get("mode", "single"),
        })
    return web.json_response({"automations": items,
                              "connected": X.HA.connected})


async def api_action(request):
    """Enable / disable / run an automation."""
    X.require_admin(request)
    body = await request.json()
    eid = str(body.get("entity_id", ""))
    action = body.get("action")
    if not eid.startswith("automation.") or action not in ("on", "off", "trigger"):
        return web.json_response({"error": "bad request"}, status=400)
    service = {"on": "turn_on", "off": "turn_off", "trigger": "trigger"}[action]
    try:
        await X.HA.call_service("automation", service, {"entity_id": eid})
    except Exception as exc:
        return web.json_response({"error": str(exc)}, status=502)
    return web.json_response({"ok": True})


async def api_get_config(request):
    """Fetch one automation's config (UI-editable automations only).

    YAML-defined automations (configured in configuration.yaml / packages)
    are not stored in HA's UI store, so the config API answers 404 for them
    even when the YAML sets an explicit `id:`. We surface that clearly so
    the frontend can explain it instead of showing a generic error.
    """
    X.require_admin(request)
    aid = request.match_info["aid"]
    status, data = await _core_rest("GET", f"/config/automation/config/{aid}")
    if status == 404:
        return web.json_response(
            {"error": "yaml_defined",
             "message": "This automation is defined in YAML "
                        "(configuration.yaml or a package), so Home Assistant's "
                        "config API cannot read or edit it."},
            status=404)
    if status != 200:
        return web.json_response({"error": data.get("message", f"HTTP {status}")},
                                 status=status)
    return web.json_response({"config": data})


async def api_save_config(request):
    """Create or update an automation. Body: {id?, config{alias, trigger, …}}."""
    X.require_admin(request)
    body = await request.json()
    cfg = body.get("config")
    if not isinstance(cfg, dict) or not str(cfg.get("alias", "")).strip():
        return web.json_response({"error": "config with an alias is required"},
                                 status=400)
    if not cfg.get("trigger") and not cfg.get("triggers"):
        return web.json_response({"error": "at least one trigger is required"},
                                 status=400)
    if not cfg.get("action") and not cfg.get("actions"):
        return web.json_response({"error": "at least one action is required"},
                                 status=400)
    aid = str(body.get("id") or uuid.uuid4().hex)
    status, data = await _core_rest("POST", f"/config/automation/config/{aid}", cfg)
    if status not in (200, 201):
        return web.json_response({"error": data.get("message", f"HTTP {status}")},
                                 status=status)
    return web.json_response({"ok": True, "id": aid})


async def api_delete_config(request):
    X.require_admin(request)
    aid = request.match_info["aid"]
    status, data = await _core_rest("DELETE", f"/config/automation/config/{aid}")
    if status != 200:
        return web.json_response({"error": data.get("message", f"HTTP {status}")},
                                 status=status)
    return web.json_response({"ok": True})


def _lenient_loader():
    """SafeLoader that turns HA's custom tags (!include, !secret, …) into
    plain values instead of crashing, so we can scan any config file."""
    class Lenient(yaml.SafeLoader):
        pass

    def unknown(loader, tag_suffix, node):
        if isinstance(node, yaml.ScalarNode):
            return loader.construct_scalar(node)
        if isinstance(node, yaml.SequenceNode):
            return loader.construct_sequence(node, deep=True)
        return loader.construct_mapping(node, deep=True)

    Lenient.add_multi_constructor("!", unknown)
    return Lenient


def _walk_for_automation(node, aid, alias, found):
    """Recursively find dicts that look like an automation and match id/alias.
    Works no matter how deep they're nested (automations.yaml lists,
    `automation:` blocks, packages, …)."""
    if isinstance(node, dict):
        looks = (("trigger" in node or "triggers" in node)
                 and ("action" in node or "actions" in node))
        if looks:
            if aid and str(node.get("id", "")) == aid:
                found.append(node)
            elif not aid and alias and str(node.get("alias", "")) == alias:
                found.append(node)
        for v in node.values():
            _walk_for_automation(v, aid, alias, found)
    elif isinstance(node, list):
        for v in node:
            _walk_for_automation(v, aid, alias, found)


def _find_yaml_automation(aid, alias):
    """Scan the HA config folder for the automation's YAML definition."""
    if yaml is None:
        raise RuntimeError("PyYAML is not available in this build")
    loader = _lenient_loader()
    found = []
    for base in HA_CONFIG_DIRS:
        if not base.is_dir():
            continue
        for p in sorted(base.rglob("*.yaml")):
            if any(part in SKIP_DIRS for part in p.parts):
                continue
            try:
                if p.stat().st_size > 2_000_000:
                    continue
                for doc in yaml.load_all(
                        p.read_text(encoding="utf-8", errors="replace"),
                        Loader=loader):
                    _walk_for_automation(doc, aid, alias, found)
            except Exception:
                continue
        break  # only the first existing config dir (they're the same mount)
    return found[0] if found else None


async def api_convert(request):
    """Convert a YAML-defined automation into an editable UI-store copy.

    Reads the definition from the user's YAML files (read-only), creates a
    new automation through HA's config API, then disables the YAML original
    so it doesn't run twice. The YAML text itself is never modified."""
    X.require_admin(request)
    body = await request.json()
    eid = str(body.get("entity_id", ""))
    aid = str(body.get("id") or "") or None
    alias = str(body.get("alias") or "") or None
    if not eid.startswith("automation.") or not (aid or alias):
        return web.json_response({"error": "bad request"}, status=400)

    try:
        cfg = await asyncio.to_thread(_find_yaml_automation, aid, alias)
    except Exception as exc:
        return web.json_response({"error": str(exc)}, status=500)
    if not cfg:
        return web.json_response(
            {"error": "not_found",
             "message": "Could not locate this automation in your YAML files. "
                        "If it lives outside /homeassistant, or is generated "
                        "dynamically, it cannot be converted automatically."},
            status=404)

    clean = {k: v for k, v in cfg.items() if k in ALLOWED_KEYS}
    desc = str(clean.get("description") or "").strip()
    clean["description"] = ((desc + "\n") if desc else "") + \
        "Converted from YAML by Advance Tools. The YAML original was " \
        "disabled and can now be deleted from your YAML files."
    if not clean.get("alias"):
        clean["alias"] = alias or eid.split(".", 1)[1]

    new_id = uuid.uuid4().hex
    status, data = await _core_rest("POST",
                                    f"/config/automation/config/{new_id}",
                                    clean)
    if status not in (200, 201):
        return web.json_response(
            {"error": data.get("message", f"HTTP {status}"),
             "message": "Home Assistant rejected the converted config: "
                        + str(data.get("message", status))},
            status=502)

    disabled = True
    try:
        await X.HA.call_service("automation", "turn_off", {"entity_id": eid})
    except Exception:
        disabled = False
    return web.json_response({"ok": True, "id": new_id, "disabled": disabled})


async def api_services(request):
    """Domain → [service names] for the action builder dropdowns."""
    X.require_admin(request)
    try:
        result = await X.HA.ws_call({"type": "get_services"})
    except Exception as exc:
        return web.json_response({"error": str(exc)}, status=502)
    slim = {dom: sorted(svcs.keys()) for dom, svcs in (result or {}).items()}
    return web.json_response({"services": slim})

# ---------------------------------------------------------------- register

def register(app, ctx, manifest):
    global X
    X = ctx
    base = "/api/tools/automation_maker"
    app.router.add_get("/tools/automation_maker/", page_tool)
    app.router.add_get(f"{base}/automations", api_list)
    app.router.add_post(f"{base}/action", api_action)
    app.router.add_get(f"{base}/config/{{aid}}", api_get_config)
    app.router.add_post(f"{base}/config", api_save_config)
    app.router.add_delete(f"{base}/config/{{aid}}", api_delete_config)
    app.router.add_post(f"{base}/convert", api_convert)
    app.router.add_get(f"{base}/services", api_services)
