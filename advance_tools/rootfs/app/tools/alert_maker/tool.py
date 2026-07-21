"""Alert Maker — Advance Tools plugin.

User-friendly watchdog rules ("left open too long", "battery low",
"device went offline", numeric thresholds, custom state watch) that are
stored as simple rule objects in /data/alert_maker.json and compiled into
real Home Assistant automations through HA's automation config API.

The generated automations are tagged in their description with
[alert_maker:<rule_id>] and should be edited only through this tool.
"""
import asyncio
import json
import uuid
from pathlib import Path

import aiohttp
from aiohttp import web

X = None  # core context (set in register)
TOOL_DIR = Path(__file__).parent

CORE_API = "http://supervisor/core/api"
MARKER = "[alert_maker:{rid}]"

RULE_TYPES = ("open_too_long", "low_battery", "offline", "numeric", "state")

# entity domain -> the state that counts as "open" for open_too_long rules
OPEN_STATE = {"cover": "open", "lock": "unlocked", "valve": "open"}

_LOCK = asyncio.Lock()


# ---------------------------------------------------------------- storage

def _store_file():
    return X.DATA / "alert_maker.json"


def _load_rules():
    f = _store_file()
    if f.exists():
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            if isinstance(data.get("rules"), dict):
                return data["rules"]
        except Exception:
            X.log.exception("alert_maker: could not read %s", f)
    return {}


def _save_rules(rules):
    f = _store_file()
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps({"rules": rules}, ensure_ascii=False, indent=2),
                   encoding="utf-8")
    tmp.replace(f)


# ---------------------------------------------------------------- HA REST

def _headers():
    return {"Authorization": f"Bearer {X.SUPERVISOR_TOKEN}",
            "Content-Type": "application/json"}


async def _core_rest(method, path, payload=None):
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


# ---------------------------------------------------------------- compile rule → automation

def _friendly(eid):
    st = X.HA.states.get(eid) or {}
    return (st.get("attributes") or {}).get("friendly_name") or eid


def _open_state(eid):
    return OPEN_STATE.get(eid.split(".")[0], "on")


def _minutes_text(minutes):
    if minutes and minutes % 60 == 0:
        h = minutes // 60
        return f"{h} hour" + ("s" if h > 1 else "")
    return f"{minutes} minute" + ("s" if minutes != 1 else "")


def _default_notification(rule):
    """(title, message) Jinja templates used when the user didn't customize."""
    t = rule["type"]
    p = rule.get("params", {})
    minutes = int(p.get("minutes") or 0)
    name_tpl = "{{ trigger.to_state.attributes.friendly_name | default(trigger.entity_id) }}"
    if t == "open_too_long":
        return ("🚪 Left open",
                f"{name_tpl} has been {{{{ trigger.to_state.state }}}} "
                f"for {_minutes_text(minutes)}.")
    if t == "low_battery":
        thr = p.get("threshold", 15)
        return ("🪫 Low battery",
                f"{name_tpl} battery is at "
                f"{{{{ trigger.to_state.state }}}}% (below {thr}%).")
    if t == "offline":
        return ("📵 Device offline",
                f"{name_tpl} has been unreachable "
                f"for {_minutes_text(minutes)}.")
    if t == "numeric":
        cond = []
        if p.get("above") not in (None, ""):
            cond.append(f"above {p['above']}")
        if p.get("below") not in (None, ""):
            cond.append(f"below {p['below']}")
        return ("📊 Value alert",
                f"{name_tpl} is {{{{ trigger.to_state.state }}}}"
                "{{ ' ' ~ trigger.to_state.attributes.unit_of_measurement "
                "if trigger.to_state.attributes.unit_of_measurement else '' }}"
                f" ({' and '.join(cond) or 'threshold crossed'}).")
    # state
    return ("🎯 State alert",
            f"{name_tpl} changed to "
            "{{ trigger.to_state.state }}.")


def _build_triggers(rule):
    t = rule["type"]
    p = rule.get("params", {})
    ents = rule["entities"]
    minutes = int(p.get("minutes") or 0)
    triggers = []

    if t == "open_too_long":
        groups = {}
        for e in ents:
            groups.setdefault(_open_state(e), []).append(e)
        for to_state, ids in sorted(groups.items()):
            trg = {"trigger": "state", "entity_id": ids, "to": to_state}
            if minutes:
                trg["for"] = {"minutes": minutes}
            triggers.append(trg)

    elif t == "low_battery":
        triggers.append({"trigger": "numeric_state", "entity_id": ents,
                         "below": float(p.get("threshold", 15))})

    elif t == "offline":
        trg = {"trigger": "state", "entity_id": ents,
               "to": ["unavailable", "unknown"]}
        if minutes:
            trg["for"] = {"minutes": minutes}
        triggers.append(trg)

    elif t == "numeric":
        trg = {"trigger": "numeric_state", "entity_id": ents}
        if p.get("above") not in (None, ""):
            trg["above"] = float(p["above"])
        if p.get("below") not in (None, ""):
            trg["below"] = float(p["below"])
        if minutes:
            trg["for"] = {"minutes": minutes}
        triggers.append(trg)

    elif t == "state":
        trg = {"trigger": "state", "entity_id": ents,
               "to": str(p.get("state", ""))}
        if minutes:
            trg["for"] = {"minutes": minutes}
        triggers.append(trg)

    return triggers


def _build_actions(rule, title, message):
    actions = []
    for target in rule.get("notify", []):
        if target == "persistent":
            actions.append({"action": "persistent_notification.create",
                            "data": {"title": title, "message": message}})
        else:
            actions.append({"action": target,
                            "data": {"title": title, "message": message}})
    return actions


def _build_automation(rule):
    title = (rule.get("title") or "").strip()
    message = (rule.get("message") or "").strip()
    d_title, d_msg = _default_notification(rule)
    title = title or d_title
    message = message or d_msg
    return {
        "alias": f"Alert: {rule['name']}",
        "description": ("Managed by Alert Maker (Advance Tools) — edit this "
                        "rule in the Alert Maker tool, not here. "
                        + MARKER.format(rid=rule["id"])),
        "mode": "single",
        "triggers": _build_triggers(rule),
        "actions": _build_actions(rule, title, message),
    }


def _automation_entity(aid):
    """Find the automation.<x> entity created for config id `aid`."""
    for eid, st in X.HA.states.items():
        if not eid.startswith("automation."):
            continue
        if str((st.get("attributes") or {}).get("id", "")) == aid:
            return eid, st
    return None, None


# ---------------------------------------------------------------- validation

def _validate(body):
    t = body.get("type")
    if t not in RULE_TYPES:
        return "unknown rule type"
    name = str(body.get("name", "")).strip()
    if not name:
        return "a name is required"
    ents = body.get("entities")
    if not isinstance(ents, list) or not ents or \
            not all(isinstance(e, str) and "." in e for e in ents):
        return "pick at least one entity"
    notify = body.get("notify")
    if not isinstance(notify, list) or not notify:
        return "pick at least one notification target"
    for n in notify:
        if n != "persistent" and not (isinstance(n, str)
                                      and n.startswith("notify.")):
            return f"invalid notification target: {n}"
    p = body.get("params") or {}
    try:
        if t in ("open_too_long", "offline"):
            if int(p.get("minutes") or 0) < 1:
                return "duration must be at least 1 minute"
        if t == "low_battery":
            thr = float(p.get("threshold", 15))
            if not 1 <= thr <= 99:
                return "battery threshold must be between 1 and 99"
        if t == "numeric":
            above = p.get("above")
            below = p.get("below")
            if above in (None, "") and below in (None, ""):
                return "set an 'above' or 'below' value (or both)"
            if above not in (None, ""):
                float(above)
            if below not in (None, ""):
                float(below)
        if t == "state" and not str(p.get("state", "")).strip():
            return "enter the state to watch for"
    except (TypeError, ValueError):
        return "invalid number in the rule settings"
    return None


# ---------------------------------------------------------------- pages

async def page_tool(request):
    if not X.is_admin(request):
        raise web.HTTPFound("/?d=__admin__")
    return web.FileResponse(TOOL_DIR / "static" / "index.html")


# ---------------------------------------------------------------- API

async def api_options(request):
    """Entities (with device_class) + notify services for the builder."""
    X.require_admin(request)
    entities = []
    for eid, st in sorted(X.HA.states.items()):
        attrs = st.get("attributes") or {}
        entities.append({
            "id": eid,
            "name": attrs.get("friendly_name") or eid,
            "domain": eid.split(".")[0],
            "state": st.get("state"),
            "unit": attrs.get("unit_of_measurement") or "",
            "device_class": attrs.get("device_class") or "",
        })
    services = []
    try:
        result = await X.HA.ws_call({"type": "get_services"})
        for svc in sorted((result or {}).get("notify", {}).keys()):
            if svc == "send_message":
                continue  # entity-based notify, needs a target entity
            services.append("notify." + svc)
    except Exception:
        X.log.exception("alert_maker: get_services failed")
    return web.json_response({"entities": entities,
                              "notify_services": services,
                              "connected": X.HA.connected})


async def api_rules(request):
    """All rules merged with the live state of their automations."""
    X.require_admin(request)
    async with _LOCK:
        rules = _load_rules()
    out = []
    for rid, rule in rules.items():
        eid, st = _automation_entity(rule.get("automation_id", ""))
        attrs = (st or {}).get("attributes") or {}
        out.append({**rule,
                    "entity_id": eid,
                    "enabled": (st or {}).get("state") == "on",
                    "exists": eid is not None,
                    "last_triggered": attrs.get("last_triggered")})
    out.sort(key=lambda r: r.get("name", "").lower())
    return web.json_response({"rules": out, "connected": X.HA.connected})


async def api_save_rule(request):
    """Create or update a rule and its backing automation."""
    X.require_admin(request)
    body = await request.json()
    err = _validate(body)
    if err:
        return web.json_response({"error": err}, status=400)

    rid = str(body.get("id") or "") or uuid.uuid4().hex[:12]
    async with _LOCK:
        rules = _load_rules()
        old = rules.get(rid) or {}
        rule = {
            "id": rid,
            "type": body["type"],
            "name": str(body["name"]).strip(),
            "entities": body["entities"],
            "params": body.get("params") or {},
            "notify": body["notify"],
            "title": str(body.get("title") or "").strip(),
            "message": str(body.get("message") or "").strip(),
            "automation_id": old.get("automation_id") or ("alertmaker" + rid),
        }
        cfg = _build_automation(rule)
        status, data = await _core_rest(
            "POST", f"/config/automation/config/{rule['automation_id']}", cfg)
        if status not in (200, 201):
            return web.json_response(
                {"error": "Home Assistant rejected the automation: "
                          + str(data.get("message", f"HTTP {status}"))},
                status=502)
        rules[rid] = rule
        _save_rules(rules)
    return web.json_response({"ok": True, "id": rid})


async def api_delete_rule(request):
    X.require_admin(request)
    rid = request.match_info["rid"]
    async with _LOCK:
        rules = _load_rules()
        rule = rules.get(rid)
        if not rule:
            return web.json_response({"error": "rule not found"}, status=404)
        status, data = await _core_rest(
            "DELETE", f"/config/automation/config/{rule['automation_id']}")
        if status not in (200, 404):   # 404 = automation already gone
            return web.json_response(
                {"error": str(data.get("message", f"HTTP {status}"))},
                status=502)
        rules.pop(rid, None)
        _save_rules(rules)
    return web.json_response({"ok": True})


async def api_rule_action(request):
    """Enable / disable a rule, or send a test notification."""
    X.require_admin(request)
    rid = request.match_info["rid"]
    body = await request.json()
    action = body.get("action")
    async with _LOCK:
        rules = _load_rules()
        rule = rules.get(rid)
    if not rule:
        return web.json_response({"error": "rule not found"}, status=404)

    if action in ("on", "off"):
        eid, _ = _automation_entity(rule["automation_id"])
        if not eid:
            return web.json_response(
                {"error": "The automation for this rule was not found in "
                          "Home Assistant. Save the rule again to recreate it."},
                status=404)
        try:
            await X.HA.call_service(
                "automation", "turn_on" if action == "on" else "turn_off",
                {"entity_id": eid})
        except Exception as exc:
            return web.json_response({"error": str(exc)}, status=502)
        return web.json_response({"ok": True})

    if action == "test":
        names = ", ".join(_friendly(e) for e in rule["entities"][:3])
        more = len(rule["entities"]) - 3
        if more > 0:
            names += f" (+{more} more)"
        title = "🧪 Test — " + (rule.get("title") or rule["name"])
        message = (f"This is a test of the alert rule \"{rule['name']}\" "
                   f"watching: {names}. If you can read this, "
                   "notifications work.")
        errors = []
        for target in rule.get("notify", []):
            try:
                if target == "persistent":
                    await X.HA.call_service(
                        "persistent_notification", "create",
                        {"title": title, "message": message})
                else:
                    domain, service = target.split(".", 1)
                    await X.HA.call_service(
                        domain, service, {"title": title, "message": message})
            except Exception as exc:
                errors.append(f"{target}: {exc}")
        if errors:
            return web.json_response({"error": "; ".join(errors)}, status=502)
        return web.json_response({"ok": True})

    return web.json_response({"error": "bad action"}, status=400)


async def api_preview(request):
    """Compile a rule body to automation YAML-ish JSON for the live preview."""
    X.require_admin(request)
    body = await request.json()
    err = _validate(body)
    if err:
        return web.json_response({"error": err}, status=400)
    rule = {
        "id": str(body.get("id") or "preview"),
        "type": body["type"],
        "name": str(body["name"]).strip(),
        "entities": body["entities"],
        "params": body.get("params") or {},
        "notify": body["notify"],
        "title": str(body.get("title") or "").strip(),
        "message": str(body.get("message") or "").strip(),
    }
    return web.json_response({"config": _build_automation(rule)})


# ---------------------------------------------------------------- register

def register(app, ctx, manifest):
    global X
    X = ctx
    base = "/api/tools/alert_maker"
    app.router.add_get("/tools/alert_maker/", page_tool)
    app.router.add_get(f"{base}/options", api_options)
    app.router.add_get(f"{base}/rules", api_rules)
    app.router.add_post(f"{base}/rules", api_save_rule)
    app.router.add_delete(f"{base}/rules/{{rid}}", api_delete_rule)
    app.router.add_post(f"{base}/rules/{{rid}}/action", api_rule_action)
    app.router.add_post(f"{base}/preview", api_preview)
