"""Notify Hub — Advance Tools plugin.

A single place to define notification *channels* (Telegram, HA notify
services, persistent notifications, webhooks) and *rules* that decide when
something gets sent.

Rule types
----------
entity       Compiled into a real Home Assistant automation. The automation
             fires the `advance_tools_notify` event with a rendered title and
             message; this add-on listens for that event and fans it out to
             the rule's channels. Templates therefore render inside HA, which
             keeps the rules native and editable/inspectable in HA itself.
system       Watched inside the add-on: HA errors/warnings (system_log_event),
             Home Assistant restarts, and add-on connection loss.
dead_device  Periodic scan for entities that went unavailable for too long or
             whose battery dropped below a threshold.
digest       A scheduled summary of the house at a chosen time of day.

The generated automations are tagged in their description with
[notify_hub:<rule_id>] and should be edited only through this tool.

Everything lives in /data/notify_hub.json.
"""
import asyncio
import html
import json
import time
import uuid
from datetime import datetime
from pathlib import Path

import aiohttp
from aiohttp import web

X = None  # core context (set in register)
TOOL_DIR = Path(__file__).parent

CORE_API = "http://supervisor/core/api"
TG_API = "https://api.telegram.org/bot{token}/{method}"
MARKER = "[notify_hub:{rid}]"
NOTIFY_EVENT = "advance_tools_notify"

CHANNEL_TYPES = ("telegram", "notify", "persistent", "webhook")
RULE_TYPES = ("entity", "system", "dead_device", "digest")

LOG_LIMIT = 300          # delivery log entries kept on disk
SCAN_SECONDS = 300       # dead-device scan interval
TICK_SECONDS = 20        # digest scheduler resolution

_LOCK = asyncio.Lock()
_STATE = {"channels": {}, "rules": {}, "settings": {}, "log": []}
_RUNTIME = {
    "cooldown": {},      # rule_id -> unix ts of last send
    "flagged": {},       # rule_id -> {entity_id: reason} already reported
    "digest_sent": {},   # rule_id -> "YYYY-MM-DD"
    "tasks": [],
    "queue": None,
    "bot_offset": 0,
    "bot_status": {"running": False, "username": "", "error": ""},
}

DEFAULT_SETTINGS = {
    "quiet_start": "",       # "23:00" — non-urgent rules are held back
    "quiet_end": "",         # "07:00"
    "muted_until": 0,        # unix ts; 0 = not muted
    "telegram": {
        "token": "",
        "polling": True,
        "allow_chats": [],   # chat ids allowed to command the bot
        "controls": [],      # entity ids offered as buttons under /control
    },
}


# ---------------------------------------------------------------- storage

def _store_file():
    return X.DATA / "notify_hub.json"


def _load():
    f = _store_file()
    data = {}
    if f.exists():
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            X.log.exception("notify_hub: could not read %s", f)
            data = {}
    _STATE["channels"] = data.get("channels") or {}
    _STATE["rules"] = data.get("rules") or {}
    _STATE["log"] = data.get("log") or []
    settings = json.loads(json.dumps(DEFAULT_SETTINGS))
    saved = data.get("settings") or {}
    settings.update({k: v for k, v in saved.items() if k != "telegram"})
    settings["telegram"].update(saved.get("telegram") or {})
    _STATE["settings"] = settings


def _save():
    f = _store_file()
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps({"channels": _STATE["channels"],
                               "rules": _STATE["rules"],
                               "settings": _STATE["settings"],
                               "log": _STATE["log"][-LOG_LIMIT:]},
                              ensure_ascii=False, indent=2),
                   encoding="utf-8")
    tmp.replace(f)


def _err(message, status=400):
    return web.json_response({"error": str(message)}, status=status)


# ---------------------------------------------------------------- helpers

def _friendly(eid):
    st = X.HA.states.get(eid) or {}
    return (st.get("attributes") or {}).get("friendly_name") or eid


def _now():
    return time.time()


def _hhmm_to_minutes(value):
    try:
        h, m = str(value).split(":")
        return int(h) * 60 + int(m)
    except Exception:
        return None


def _in_quiet_hours():
    s = _STATE["settings"]
    start = _hhmm_to_minutes(s.get("quiet_start"))
    end = _hhmm_to_minutes(s.get("quiet_end"))
    if start is None or end is None or start == end:
        return False
    now = datetime.now()
    minutes = now.hour * 60 + now.minute
    if start < end:                      # 13:00 → 18:00
        return start <= minutes < end
    return minutes >= start or minutes < end   # 23:00 → 07:00 (over midnight)


def _is_muted():
    return _now() < float(_STATE["settings"].get("muted_until") or 0)


def _log_delivery(rule, title, message, results, skipped=""):
    _STATE["log"].append({
        "ts": int(_now()),
        "rule_id": (rule or {}).get("id", ""),
        "rule": (rule or {}).get("name", "Manual"),
        "title": title,
        "message": message,
        "skipped": skipped,
        "results": results,
    })
    del _STATE["log"][:-LOG_LIMIT]


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


# ---------------------------------------------------------------- channels: sending

async def _tg_call(method, payload, token=None):
    """Call the Telegram Bot API. Returns (ok, result_or_error_text)."""
    token = token or _STATE["settings"]["telegram"].get("token") or ""
    if not token:
        return False, "no Telegram bot token configured"
    url = TG_API.format(token=token, method=method)
    try:
        async with aiohttp.ClientSession() as s:
            async with s.post(url, json=payload,
                              timeout=aiohttp.ClientTimeout(total=40)) as r:
                data = await r.json(content_type=None)
        if not data.get("ok"):
            return False, str(data.get("description") or f"HTTP {r.status}")
        return True, data.get("result")
    except Exception as exc:
        return False, str(exc)


async def _send_telegram(channel, title, message):
    cfg = channel.get("config") or {}
    chat_id = str(cfg.get("chat_id", "")).strip()
    if not chat_id:
        return False, "this Telegram channel has no chat ID"
    text = f"<b>{html.escape(title)}</b>\n{html.escape(message)}" if title \
        else html.escape(message)
    payload = {"chat_id": chat_id, "text": text[:4000],
               "parse_mode": "HTML", "disable_web_page_preview": True}
    if cfg.get("thread_id"):
        payload["message_thread_id"] = int(cfg["thread_id"])
    ok, result = await _tg_call("sendMessage", payload)
    return ok, "" if ok else str(result)


async def _send_notify(channel, title, message):
    service = (channel.get("config") or {}).get("service", "")
    if not service.startswith("notify."):
        return False, "invalid notify service"
    try:
        domain, name = service.split(".", 1)
        await X.HA.call_service(domain, name,
                                {"title": title, "message": message})
        return True, ""
    except Exception as exc:
        return False, str(exc)


async def _send_persistent(channel, title, message):
    try:
        await X.HA.call_service("persistent_notification", "create",
                                {"title": title or "Notify Hub",
                                 "message": message})
        return True, ""
    except Exception as exc:
        return False, str(exc)


async def _send_webhook(channel, title, message):
    cfg = channel.get("config") or {}
    url = (cfg.get("url") or "").strip()
    if not url.startswith(("http://", "https://")):
        return False, "invalid webhook URL"
    fmt = cfg.get("format") or "json"
    full = f"{title}\n{message}" if title else message
    if fmt == "discord":
        payload = {"content": full[:1900]}
    elif fmt == "slack":
        payload = {"text": full[:3000]}
    else:
        payload = {"title": title, "message": message,
                   "timestamp": int(_now())}
    headers = {"Content-Type": "application/json"}
    extra = cfg.get("headers")
    if isinstance(extra, dict):
        headers.update({str(k): str(v) for k, v in extra.items()})
    try:
        async with aiohttp.ClientSession() as s:
            async with s.post(url, json=payload, headers=headers,
                              timeout=aiohttp.ClientTimeout(total=15)) as r:
                if r.status >= 400:
                    return False, f"HTTP {r.status}: {(await r.text())[:120]}"
        return True, ""
    except Exception as exc:
        return False, str(exc)


SENDERS = {
    "telegram": _send_telegram,
    "notify": _send_notify,
    "persistent": _send_persistent,
    "webhook": _send_webhook,
}


async def _send_to_channel(cid, title, message):
    channel = _STATE["channels"].get(cid)
    if not channel:
        return {"channel": cid, "name": cid, "ok": False,
                "error": "channel no longer exists"}
    if not channel.get("enabled", True):
        return {"channel": cid, "name": channel.get("name", cid), "ok": False,
                "error": "channel is switched off"}
    sender = SENDERS.get(channel.get("type"))
    if not sender:
        return {"channel": cid, "name": channel.get("name", cid), "ok": False,
                "error": "unknown channel type"}
    try:
        ok, error = await sender(channel, title, message)
    except Exception as exc:
        ok, error = False, str(exc)
    return {"channel": cid, "name": channel.get("name", cid),
            "ok": ok, "error": error}


# ---------------------------------------------------------------- dispatcher

async def _dispatch(rule, title, message, force=False):
    """Deliver one notification to every channel of a rule.

    Honours mute, quiet hours and the rule's cooldown unless `force` is set
    (used by the Test buttons) or the rule is marked urgent.
    """
    rid = rule.get("id", "")
    urgent = bool(rule.get("urgent"))
    channels = rule.get("channels") or []

    if not force:
        if _is_muted() and not urgent:
            _log_delivery(rule, title, message, [], "everything is muted")
            _save()
            return
        if _in_quiet_hours() and not urgent:
            _log_delivery(rule, title, message, [], "quiet hours")
            _save()
            return
        cooldown = int(rule.get("cooldown") or 0)
        if cooldown:
            last = _RUNTIME["cooldown"].get(rid, 0)
            if _now() - last < cooldown * 60:
                _log_delivery(rule, title, message, [],
                              f"cooldown ({cooldown} min)")
                _save()
                return

    results = [await _send_to_channel(cid, title, message) for cid in channels]
    if not channels:
        results = [{"channel": "", "name": "—", "ok": False,
                    "error": "this rule has no channels selected"}]
    if any(r["ok"] for r in results):
        _RUNTIME["cooldown"][rid] = _now()
    _log_delivery(rule, title, message, results)
    _save()
    return results


# ---------------------------------------------------------------- entity rules → HA automation

def _default_text(rule):
    """(title, message) Jinja templates used when the user didn't customise."""
    p = rule.get("params") or {}
    name_tpl = ("{{ trigger.to_state.attributes.friendly_name "
                "| default(trigger.entity_id) }}")
    mode = p.get("mode", "state")
    if mode == "numeric":
        return ("📊 " + rule["name"],
                f"{name_tpl} is now {{{{ trigger.to_state.state }}}}"
                "{{ ' ' ~ trigger.to_state.attributes.unit_of_measurement "
                "if trigger.to_state.attributes.unit_of_measurement else '' }}.")
    if mode == "any":
        return ("🎯 " + rule["name"],
                f"{name_tpl} changed to {{{{ trigger.to_state.state }}}}.")
    return ("🔔 " + rule["name"],
            f"{name_tpl} is now {{{{ trigger.to_state.state }}}}.")


def _build_triggers(rule):
    p = rule.get("params") or {}
    ents = p.get("entities") or []
    mode = p.get("mode", "state")
    minutes = int(p.get("for_minutes") or 0)

    if mode == "numeric":
        trg = {"trigger": "numeric_state", "entity_id": ents}
        if p.get("above") not in (None, ""):
            trg["above"] = float(p["above"])
        if p.get("below") not in (None, ""):
            trg["below"] = float(p["below"])
    elif mode == "any":
        trg = {"trigger": "state", "entity_id": ents}
    else:
        trg = {"trigger": "state", "entity_id": ents}
        if str(p.get("to", "")).strip():
            trg["to"] = str(p["to"]).strip()
        if str(p.get("from", "")).strip():
            trg["from"] = str(p["from"]).strip()
    if minutes:
        trg["for"] = {"minutes": minutes}
    return [trg]


def _build_conditions(rule):
    p = rule.get("params") or {}
    conditions = []
    after = str(p.get("only_after", "")).strip()
    before = str(p.get("only_before", "")).strip()
    if after or before:
        cond = {"condition": "time"}
        if after:
            cond["after"] = after
        if before:
            cond["before"] = before
        conditions.append(cond)
    return conditions


def _build_automation(rule):
    title = (rule.get("title") or "").strip()
    message = (rule.get("message") or "").strip()
    d_title, d_message = _default_text(rule)
    return {
        "alias": f"Notify: {rule['name']}",
        "description": ("Managed by Notify Hub (Advance Tools) — edit this "
                        "rule in the Notify Hub tool, not here. "
                        + MARKER.format(rid=rule["id"])),
        "mode": "queued",
        "max": 10,
        "triggers": _build_triggers(rule),
        "conditions": _build_conditions(rule),
        "actions": [{
            "event": NOTIFY_EVENT,
            "event_data": {
                "rule": rule["id"],
                "title": title or d_title,
                "message": message or d_message,
            },
        }],
    }


def _automation_entity(aid):
    """Find the automation.<x> entity created for config id `aid`."""
    for eid, st in X.HA.states.items():
        if not eid.startswith("automation."):
            continue
        if str((st.get("attributes") or {}).get("id", "")) == aid:
            return eid, st
    return None, None


async def _push_automation(rule):
    cfg = _build_automation(rule)
    status, data = await _core_rest(
        "POST", f"/config/automation/config/{rule['automation_id']}", cfg)
    if status not in (200, 201):
        raise RuntimeError("Home Assistant rejected the automation: "
                           + str(data.get("message", f"HTTP {status}")))


async def _set_automation_state(rule, on):
    eid, _ = _automation_entity(rule.get("automation_id", ""))
    if not eid:
        return
    await X.HA.call_service("automation", "turn_on" if on else "turn_off",
                            {"entity_id": eid})


# ---------------------------------------------------------------- rule validation

def _validate(body):
    t = body.get("type")
    if t not in RULE_TYPES:
        return "unknown rule type"
    if not str(body.get("name", "")).strip():
        return "a name is required"
    channels = body.get("channels")
    if not isinstance(channels, list) or not channels:
        return "pick at least one channel"
    for cid in channels:
        if cid not in _STATE["channels"]:
            return "one of the selected channels no longer exists"
    p = body.get("params") or {}

    if t == "entity":
        ents = p.get("entities")
        if not isinstance(ents, list) or not ents or \
                not all(isinstance(e, str) and "." in e for e in ents):
            return "pick at least one entity"
        mode = p.get("mode", "state")
        if mode not in ("state", "numeric", "any"):
            return "unknown trigger mode"
        try:
            if mode == "numeric":
                above, below = p.get("above"), p.get("below")
                if above in (None, "") and below in (None, ""):
                    return "set an 'above' or 'below' value (or both)"
                if above not in (None, ""):
                    float(above)
                if below not in (None, ""):
                    float(below)
            if mode == "state" and not str(p.get("to", "")).strip() \
                    and not str(p.get("from", "")).strip():
                return "enter the state to watch for"
            int(p.get("for_minutes") or 0)
        except (TypeError, ValueError):
            return "invalid number in the rule settings"

    elif t == "system":
        watch = p.get("watch")
        if not isinstance(watch, list) or not watch:
            return "pick at least one thing to watch"

    elif t == "dead_device":
        try:
            if int(p.get("unavailable_minutes") or 0) < 1:
                return "the unavailable duration must be at least 1 minute"
            if p.get("check_battery"):
                thr = float(p.get("battery_threshold", 15))
                if not 1 <= thr <= 99:
                    return "the battery threshold must be between 1 and 99"
        except (TypeError, ValueError):
            return "invalid number in the rule settings"

    elif t == "digest":
        if _hhmm_to_minutes(p.get("time")) is None:
            return "enter a valid time like 08:00"
        if not isinstance(p.get("sections"), list) or not p["sections"]:
            return "pick at least one section for the digest"
        days = p.get("days")
        if not isinstance(days, list) or not days:
            return "pick at least one day"
    return None


# ---------------------------------------------------------------- internal watchers: system

async def _event_loop():
    """Fan out HA events: our own notify event, log errors and restarts."""
    queue = _RUNTIME["queue"]
    while True:
        try:
            msg = await queue.get()
            etype = msg.get("event_type")
            data = msg.get("data") or {}
            if etype == NOTIFY_EVENT:
                await _handle_notify_event(data)
            elif etype == "system_log_event":
                await _handle_log_event(data)
            elif etype == "homeassistant_start":
                await _handle_system_trigger(
                    "ha_start", "♻️ Home Assistant restarted",
                    "Home Assistant has finished starting up.")
        except asyncio.CancelledError:
            raise
        except Exception:
            X.log.exception("notify_hub: event handling failed")


async def _handle_notify_event(data):
    rid = str(data.get("rule", ""))
    async with _LOCK:
        rule = _STATE["rules"].get(rid)
    if not rule or not rule.get("enabled", True):
        return
    async with _LOCK:
        await _dispatch(rule, str(data.get("title", "")),
                        str(data.get("message", "")))


async def _handle_log_event(data):
    level = str(data.get("level", "")).upper()
    if level not in ("ERROR", "CRITICAL", "WARNING"):
        return
    async with _LOCK:
        rules = [r for r in _STATE["rules"].values()
                 if r.get("type") == "system" and r.get("enabled", True)]
    if not rules:
        return
    source = data.get("name") or "unknown"
    text = str(data.get("message") or "")
    if isinstance(data.get("message"), list):
        text = " ".join(str(m) for m in data["message"])
    key = "errors" if level in ("ERROR", "CRITICAL") else "warnings"
    icon = "❌" if key == "errors" else "⚠️"
    for rule in rules:
        watch = (rule.get("params") or {}).get("watch") or []
        if key not in watch:
            continue
        ignore = [s.lower() for s in
                  ((rule.get("params") or {}).get("ignore") or [])]
        haystack = (source + " " + text).lower()
        if any(word and word in haystack for word in ignore):
            continue
        async with _LOCK:
            await _dispatch(rule, f"{icon} Home Assistant {level.lower()}",
                            f"{source}\n{text[:600]}")


async def _handle_system_trigger(key, title, message):
    async with _LOCK:
        rules = [r for r in _STATE["rules"].values()
                 if r.get("type") == "system" and r.get("enabled", True)
                 and key in ((r.get("params") or {}).get("watch") or [])]
        for rule in rules:
            await _dispatch(rule, title, message)


# ---------------------------------------------------------------- internal watchers: dead devices

def _battery_level(eid, st):
    attrs = st.get("attributes") or {}
    if attrs.get("device_class") == "battery" and eid.startswith("sensor."):
        try:
            return float(st.get("state"))
        except (TypeError, ValueError):
            return None
    return None


async def _scan_dead_devices():
    async with _LOCK:
        rules = [r for r in _STATE["rules"].values()
                 if r.get("type") == "dead_device" and r.get("enabled", True)]
    if not rules or not X.HA.connected:
        return

    now = _now()
    for rule in rules:
        p = rule.get("params") or {}
        minutes = int(p.get("unavailable_minutes") or 30)
        ignore = set(p.get("ignore") or [])
        flagged = _RUNTIME["flagged"].setdefault(rule["id"], {})
        problems = []

        for eid, st in X.HA.states.items():
            if eid in ignore or eid.startswith(("automation.", "script.",
                                                "scene.", "input_")):
                continue
            state = st.get("state")
            if state in ("unavailable", "unknown"):
                changed = st.get("last_changed") or ""
                try:
                    ts = datetime.fromisoformat(
                        changed.replace("Z", "+00:00")).timestamp()
                except Exception:
                    ts = now
                if now - ts >= minutes * 60 and flagged.get(eid) != "dead":
                    flagged[eid] = "dead"
                    problems.append(f"📵 {_friendly(eid)} — {state}")
                continue

            if p.get("check_battery"):
                level = _battery_level(eid, st)
                threshold = float(p.get("battery_threshold", 15))
                if level is not None and level <= threshold:
                    if flagged.get(eid) != "battery":
                        flagged[eid] = "battery"
                        problems.append(
                            f"🪫 {_friendly(eid)} — battery {level:g}%")
                    continue
            if eid in flagged:
                flagged.pop(eid, None)      # recovered — allow re-reporting

        if problems:
            head = problems[:15]
            more = len(problems) - len(head)
            message = "\n".join(head)
            if more > 0:
                message += f"\n… and {more} more."
            async with _LOCK:
                await _dispatch(rule, "🩺 " + rule["name"], message)


async def _scan_loop():
    await asyncio.sleep(60)              # let HA states settle after start
    while True:
        try:
            await _scan_dead_devices()
        except asyncio.CancelledError:
            raise
        except Exception:
            X.log.exception("notify_hub: dead-device scan failed")
        await asyncio.sleep(SCAN_SECONDS)


# ---------------------------------------------------------------- digest

DIGEST_SECTIONS = {
    "lights_on": "Lights on",
    "switches_on": "Switches on",
    "doors_open": "Doors & windows open",
    "covers_open": "Covers open",
    "locks_unlocked": "Unlocked locks",
    "climate": "Climate",
    "batteries": "Low batteries",
    "unavailable": "Unavailable entities",
}


def _build_digest(sections):
    lines = []

    def add(header, items):
        if not items:
            lines.append(f"✅ {header}: none")
            return
        head = items[:12]
        text = ", ".join(head)
        if len(items) > len(head):
            text += f" … (+{len(items) - len(head)})"
        lines.append(f"• {header} ({len(items)}): {text}")

    states = X.HA.states
    if "lights_on" in sections:
        add(DIGEST_SECTIONS["lights_on"],
            [_friendly(e) for e, s in states.items()
             if e.startswith("light.") and s.get("state") == "on"])
    if "switches_on" in sections:
        add(DIGEST_SECTIONS["switches_on"],
            [_friendly(e) for e, s in states.items()
             if e.startswith("switch.") and s.get("state") == "on"])
    if "doors_open" in sections:
        add(DIGEST_SECTIONS["doors_open"],
            [_friendly(e) for e, s in states.items()
             if e.startswith("binary_sensor.") and s.get("state") == "on"
             and (s.get("attributes") or {}).get("device_class")
             in ("door", "window", "garage_door", "opening")])
    if "covers_open" in sections:
        add(DIGEST_SECTIONS["covers_open"],
            [_friendly(e) for e, s in states.items()
             if e.startswith("cover.") and s.get("state") == "open"])
    if "locks_unlocked" in sections:
        add(DIGEST_SECTIONS["locks_unlocked"],
            [_friendly(e) for e, s in states.items()
             if e.startswith("lock.") and s.get("state") == "unlocked"])
    if "climate" in sections:
        items = []
        for e, s in states.items():
            if not e.startswith("climate."):
                continue
            attrs = s.get("attributes") or {}
            current = attrs.get("current_temperature")
            target = attrs.get("temperature")
            items.append(f"{_friendly(e)} {s.get('state')}"
                         + (f" ({current}→{target})"
                            if current is not None and target is not None
                            else ""))
        add(DIGEST_SECTIONS["climate"], items)
    if "batteries" in sections:
        items = []
        for e, s in states.items():
            level = _battery_level(e, s)
            if level is not None and level <= 20:
                items.append(f"{_friendly(e)} {level:g}%")
        add(DIGEST_SECTIONS["batteries"], items)
    if "unavailable" in sections:
        add(DIGEST_SECTIONS["unavailable"],
            [_friendly(e) for e, s in states.items()
             if s.get("state") in ("unavailable", "unknown")
             and not e.startswith(("automation.", "script.", "scene."))])
    return "\n".join(lines) or "Nothing to report."


async def _digest_loop():
    while True:
        try:
            now = datetime.now()
            today = now.strftime("%Y-%m-%d")
            minutes = now.hour * 60 + now.minute
            async with _LOCK:
                rules = [r for r in _STATE["rules"].values()
                         if r.get("type") == "digest" and r.get("enabled", True)]
            for rule in rules:
                p = rule.get("params") or {}
                target = _hhmm_to_minutes(p.get("time"))
                if target is None:
                    continue
                if now.weekday() not in [int(d) for d in (p.get("days") or [])]:
                    continue
                if _RUNTIME["digest_sent"].get(rule["id"]) == today:
                    continue
                if not 0 <= minutes - target < 5:
                    continue
                _RUNTIME["digest_sent"][rule["id"]] = today
                body = _build_digest(p.get("sections") or [])
                async with _LOCK:
                    await _dispatch(rule, "📰 " + rule["name"], body)
        except asyncio.CancelledError:
            raise
        except Exception:
            X.log.exception("notify_hub: digest scheduler failed")
        await asyncio.sleep(TICK_SECONDS)


# ---------------------------------------------------------------- Telegram bot (two-way)

def _bot_allowed(chat_id):
    allow = [str(c) for c in
             (_STATE["settings"]["telegram"].get("allow_chats") or [])]
    return str(chat_id) in allow


async def _bot_send(chat_id, text, keyboard=None):
    payload = {"chat_id": chat_id, "text": text[:4000], "parse_mode": "HTML",
               "disable_web_page_preview": True}
    if keyboard:
        payload["reply_markup"] = {"inline_keyboard": keyboard}
    return await _tg_call("sendMessage", payload)


def _status_text():
    states = X.HA.states
    lights = [e for e, s in states.items()
              if e.startswith("light.") and s.get("state") == "on"]
    open_sensors = [e for e, s in states.items()
                    if e.startswith("binary_sensor.") and s.get("state") == "on"
                    and (s.get("attributes") or {}).get("device_class")
                    in ("door", "window", "garage_door", "opening")]
    unavailable = [e for e, s in states.items()
                   if s.get("state") in ("unavailable", "unknown")]
    alarm = [f"{_friendly(e)}: {s.get('state')}" for e, s in states.items()
             if e.startswith("alarm_control_panel.")]
    lines = [
        "<b>🏠 House status</b>",
        f"Entities: {len(states)}",
        f"💡 Lights on: {len(lights)}"
        + (" — " + ", ".join(_friendly(e) for e in lights[:6]) if lights else ""),
        f"🚪 Open doors/windows: {len(open_sensors)}"
        + (" — " + ", ".join(_friendly(e) for e in open_sensors[:6])
           if open_sensors else ""),
        f"📵 Unavailable: {len(unavailable)}",
    ]
    if alarm:
        lines.append("🛡️ " + " | ".join(alarm[:3]))
    muted = _STATE["settings"].get("muted_until") or 0
    if _now() < muted:
        left = int((muted - _now()) / 60)
        lines.append(f"🔕 Muted for another {left} min")
    return "\n".join(lines)


def _rules_keyboard():
    rows = []
    for rule in sorted(_STATE["rules"].values(),
                       key=lambda r: r.get("name", "").lower()):
        on = rule.get("enabled", True)
        rows.append([{
            "text": f"{'🟢' if on else '⚪'} {rule.get('name', '?')[:40]}",
            "callback_data": f"rule:{rule['id']}:{'off' if on else 'on'}",
        }])
    return rows[:40]


def _controls_keyboard():
    rows = []
    for eid in (_STATE["settings"]["telegram"].get("controls") or [])[:30]:
        st = X.HA.states.get(eid) or {}
        on = st.get("state") in ("on", "open", "unlocked", "home")
        rows.append([{"text": f"{'🟡' if on else '⚫'} {_friendly(eid)[:38]}",
                      "callback_data": f"ctl:{eid}"}])
    return rows


HELP_TEXT = (
    "<b>🔔 Notify Hub bot</b>\n"
    "/status — how the house is right now\n"
    "/rules — list your rules, tap one to switch it on or off\n"
    "/control — buttons for the devices you allowed\n"
    "/find &lt;text&gt; — look up any entity and its state\n"
    "/mute 2h — hold non-urgent notifications (m/h/d)\n"
    "/unmute — start sending again\n"
    "/log — the last few notifications that went out\n"
    "/help — this message"
)


async def _bot_command(chat_id, text):
    parts = text.strip().split()
    cmd = parts[0].lower().split("@")[0]
    arg = " ".join(parts[1:]).strip()

    if cmd in ("/start", "/help"):
        await _bot_send(chat_id, HELP_TEXT)
    elif cmd == "/status":
        await _bot_send(chat_id, _status_text())
    elif cmd == "/rules":
        rows = _rules_keyboard()
        await _bot_send(chat_id,
                        "<b>Your rules</b>\nTap to switch one on or off."
                        if rows else "You have no rules yet.", rows)
    elif cmd == "/control":
        rows = _controls_keyboard()
        await _bot_send(chat_id,
                        "<b>Quick controls</b>\nTap to toggle." if rows else
                        "No quick controls configured. Add some in "
                        "Notify Hub → Telegram bot.", rows)
    elif cmd == "/find":
        if not arg:
            await _bot_send(chat_id, "Usage: /find kitchen")
            return
        needle = arg.lower()
        hits = [f"{_friendly(e)} (<code>{html.escape(e)}</code>): "
                f"{html.escape(str(s.get('state')))}"
                for e, s in sorted(X.HA.states.items())
                if needle in e.lower() or needle in _friendly(e).lower()][:20]
        await _bot_send(chat_id, "\n".join(hits) if hits else "Nothing found.")
    elif cmd == "/mute":
        seconds = 3600
        if arg:
            try:
                unit = arg[-1].lower()
                value = float(arg[:-1] if unit in "mhd" else arg)
                seconds = value * {"m": 60, "h": 3600, "d": 86400}.get(unit, 60)
            except ValueError:
                await _bot_send(chat_id, "Usage: /mute 30m, /mute 2h, /mute 1d")
                return
        async with _LOCK:
            _STATE["settings"]["muted_until"] = _now() + seconds
            _save()
        await _bot_send(chat_id,
                        f"🔕 Muted for {int(seconds / 60)} minutes. "
                        "Urgent rules still get through.")
    elif cmd == "/unmute":
        async with _LOCK:
            _STATE["settings"]["muted_until"] = 0
            _save()
        await _bot_send(chat_id, "🔔 Notifications are back on.")
    elif cmd == "/log":
        entries = _STATE["log"][-8:]
        if not entries:
            await _bot_send(chat_id, "Nothing has been sent yet.")
            return
        lines = []
        for e in reversed(entries):
            when = datetime.fromtimestamp(e["ts"]).strftime("%d %b %H:%M")
            mark = "⏸" if e.get("skipped") else (
                "✅" if any(r.get("ok") for r in e.get("results") or []) else "❌")
            lines.append(f"{mark} {when} — {html.escape(e.get('rule', ''))}: "
                         f"{html.escape(e.get('title', ''))}")
        await _bot_send(chat_id, "<b>Recent notifications</b>\n" + "\n".join(lines))
    else:
        await _bot_send(chat_id, "I don't know that one.\n\n" + HELP_TEXT)


async def _bot_callback(query):
    chat_id = ((query.get("message") or {}).get("chat") or {}).get("id")
    data = str(query.get("data") or "")
    answer = "Done"
    if not _bot_allowed(chat_id):
        answer = "Not allowed"
    elif data.startswith("rule:"):
        _, rid, action = data.split(":", 2)
        async with _LOCK:
            rule = _STATE["rules"].get(rid)
            if rule:
                rule["enabled"] = action == "on"
                _save()
                if rule.get("type") == "entity":
                    try:
                        await _set_automation_state(rule, rule["enabled"])
                    except Exception:
                        X.log.exception("notify_hub: toggle automation failed")
                answer = f"{rule['name']}: {'on' if rule['enabled'] else 'off'}"
            else:
                answer = "Rule not found"
        await _tg_call("editMessageReplyMarkup", {
            "chat_id": chat_id,
            "message_id": (query.get("message") or {}).get("message_id"),
            "reply_markup": {"inline_keyboard": _rules_keyboard()},
        })
    elif data.startswith("ctl:"):
        eid = data.split(":", 1)[1]
        if eid not in (_STATE["settings"]["telegram"].get("controls") or []):
            answer = "Not allowed"
        else:
            domain = eid.split(".")[0]
            service_domain = domain if domain in (
                "light", "switch", "fan", "cover", "lock", "input_boolean",
                "media_player", "script", "scene", "climate") else "homeassistant"
            service = "toggle"
            if domain == "lock":
                st = X.HA.states.get(eid) or {}
                service = "unlock" if st.get("state") == "locked" else "lock"
            elif domain == "cover":
                st = X.HA.states.get(eid) or {}
                service = "close_cover" if st.get("state") == "open" \
                    else "open_cover"
            elif domain in ("script", "scene"):
                service = "turn_on"
            try:
                await X.HA.call_service(service_domain, service,
                                        {"entity_id": eid})
                answer = f"{_friendly(eid)} → {service.replace('_', ' ')}"
            except Exception as exc:
                answer = str(exc)[:180]
        await asyncio.sleep(1.2)         # let the state settle before redraw
        await _tg_call("editMessageReplyMarkup", {
            "chat_id": chat_id,
            "message_id": (query.get("message") or {}).get("message_id"),
            "reply_markup": {"inline_keyboard": _controls_keyboard()},
        })
    await _tg_call("answerCallbackQuery",
                   {"callback_query_id": query.get("id"), "text": answer[:200]})


async def _bot_loop():
    """Long-poll getUpdates while a token is configured and polling is on."""
    status = _RUNTIME["bot_status"]
    while True:
        try:
            tg = _STATE["settings"]["telegram"]
            if not tg.get("token") or not tg.get("polling", True):
                status.update({"running": False, "username": "", "error": ""})
                await asyncio.sleep(15)
                continue

            if not status.get("username"):
                ok, me = await _tg_call("getMe", {})
                if not ok:
                    status.update({"running": False, "error": str(me)})
                    await asyncio.sleep(30)
                    continue
                status.update({"running": True, "error": "",
                               "username": (me or {}).get("username", "")})
                X.log.info("notify_hub: Telegram bot @%s connected",
                           status["username"])

            ok, result = await _tg_call("getUpdates", {
                "offset": _RUNTIME["bot_offset"],
                "timeout": 30,
                "allowed_updates": ["message", "callback_query"],
            })
            if not ok:
                status.update({"error": str(result)})
                await asyncio.sleep(10)
                continue
            status["error"] = ""

            for update in result or []:
                _RUNTIME["bot_offset"] = int(update.get("update_id", 0)) + 1
                if "callback_query" in update:
                    await _bot_callback(update["callback_query"])
                    continue
                message = update.get("message") or {}
                chat = message.get("chat") or {}
                chat_id = chat.get("id")
                text = str(message.get("text") or "")
                if chat_id is None or not text:
                    continue
                if not _bot_allowed(chat_id):
                    await _bot_send(
                        chat_id,
                        "👋 This bot is not linked to your Home Assistant yet.\n"
                        f"Your chat ID is <code>{chat_id}</code>.\n"
                        "Add it in Advance Tools → Notify Hub → Telegram bot "
                        "to allow commands from here.")
                    continue
                await _bot_command(chat_id, text)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            status.update({"error": str(exc)})
            X.log.exception("notify_hub: Telegram polling failed")
            await asyncio.sleep(10)


# ---------------------------------------------------------------- pages

async def page_tool(request):
    if not X.is_admin(request):
        raise web.HTTPFound("/?d=__admin__")
    return web.FileResponse(TOOL_DIR / "static" / "index.html")


# ---------------------------------------------------------------- API

async def api_data(request):
    """Everything the UI needs in one call."""
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
                continue          # entity-based notify, needs a target entity
            services.append("notify." + svc)
    except Exception:
        X.log.exception("notify_hub: get_services failed")

    rules = []
    for rule in _STATE["rules"].values():
        item = dict(rule)
        if rule.get("type") == "entity":
            eid, st = _automation_entity(rule.get("automation_id", ""))
            item["entity_id"] = eid
            item["exists"] = eid is not None
            item["last_triggered"] = ((st or {}).get("attributes")
                                      or {}).get("last_triggered")
        rules.append(item)
    rules.sort(key=lambda r: r.get("name", "").lower())

    settings = json.loads(json.dumps(_STATE["settings"]))
    settings["telegram"]["token_set"] = bool(settings["telegram"].get("token"))
    settings["telegram"].pop("token", None)      # never leak the token back

    return web.json_response({
        "channels": sorted(_STATE["channels"].values(),
                           key=lambda c: c.get("name", "").lower()),
        "rules": rules,
        "settings": settings,
        "entities": entities,
        "notify_services": services,
        "digest_sections": DIGEST_SECTIONS,
        "bot": _RUNTIME["bot_status"],
        "log": list(reversed(_STATE["log"][-80:])),
        "connected": X.HA.connected,
        "muted": _is_muted(),
        "quiet_now": _in_quiet_hours(),
    })


async def api_save_channel(request):
    X.require_admin(request)
    body = await request.json()
    ctype = body.get("type")
    if ctype not in CHANNEL_TYPES:
        return _err("unknown channel type")
    name = str(body.get("name", "")).strip()
    if not name:
        return _err("a name is required")
    cfg = body.get("config") or {}

    if ctype == "telegram" and not str(cfg.get("chat_id", "")).strip():
        return _err("enter the chat ID this channel should message")
    if ctype == "notify" and not str(cfg.get("service", "")).startswith("notify."):
        return _err("pick a notify service")
    if ctype == "webhook" and not str(cfg.get("url", "")).startswith(
            ("http://", "https://")):
        return _err("enter a webhook URL starting with http:// or https://")

    cid = str(body.get("id") or "") or uuid.uuid4().hex[:12]
    async with _LOCK:
        _STATE["channels"][cid] = {
            "id": cid,
            "type": ctype,
            "name": name,
            "enabled": bool(body.get("enabled", True)),
            "config": cfg,
        }
        _save()
    return web.json_response({"ok": True, "id": cid})


async def api_delete_channel(request):
    X.require_admin(request)
    cid = request.match_info["cid"]
    async with _LOCK:
        if cid not in _STATE["channels"]:
            return _err("channel not found", 404)
        used = [r["name"] for r in _STATE["rules"].values()
                if cid in (r.get("channels") or [])]
        if used:
            return _err("still used by: " + ", ".join(used[:5]))
        _STATE["channels"].pop(cid, None)
        _save()
    return web.json_response({"ok": True})


async def api_test_channel(request):
    X.require_admin(request)
    cid = request.match_info["cid"]
    if cid not in _STATE["channels"]:
        return _err("channel not found", 404)
    result = await _send_to_channel(
        cid, "🧪 Notify Hub test",
        "If you can read this, this channel works. Sent from Advance Tools.")
    async with _LOCK:
        _log_delivery({"id": "", "name": "Channel test"},
                      "🧪 Notify Hub test", "Test message", [result])
        _save()
    if not result["ok"]:
        return _err(result["error"], 502)
    return web.json_response({"ok": True})


async def api_save_rule(request):
    X.require_admin(request)
    body = await request.json()
    err = _validate(body)
    if err:
        return _err(err)

    rid = str(body.get("id") or "") or uuid.uuid4().hex[:12]
    async with _LOCK:
        old = _STATE["rules"].get(rid) or {}
        rule = {
            "id": rid,
            "type": body["type"],
            "name": str(body["name"]).strip(),
            "enabled": bool(body.get("enabled", True)),
            "urgent": bool(body.get("urgent")),
            "cooldown": int(body.get("cooldown") or 0),
            "channels": body["channels"],
            "params": body.get("params") or {},
            "title": str(body.get("title") or "").strip(),
            "message": str(body.get("message") or "").strip(),
            "automation_id": old.get("automation_id") or ("notifyhub" + rid),
        }
        if rule["type"] == "entity":
            try:
                await _push_automation(rule)
            except Exception as exc:
                return _err(exc, 502)
        elif old.get("type") == "entity":
            # rule changed away from entity — clean up its automation
            await _core_rest("DELETE",
                             f"/config/automation/config/{rule['automation_id']}")
        _STATE["rules"][rid] = rule
        _RUNTIME["flagged"].pop(rid, None)
        _save()
        if rule["type"] == "entity":
            try:
                await _set_automation_state(rule, rule["enabled"])
            except Exception:
                X.log.exception("notify_hub: could not set automation state")
    return web.json_response({"ok": True, "id": rid})


async def api_delete_rule(request):
    X.require_admin(request)
    rid = request.match_info["rid"]
    async with _LOCK:
        rule = _STATE["rules"].get(rid)
        if not rule:
            return _err("rule not found", 404)
        if rule.get("type") == "entity":
            status, data = await _core_rest(
                "DELETE", f"/config/automation/config/{rule['automation_id']}")
            if status not in (200, 404):
                return _err(str(data.get("message", f"HTTP {status}")), 502)
        _STATE["rules"].pop(rid, None)
        _RUNTIME["flagged"].pop(rid, None)
        _save()
    return web.json_response({"ok": True})


async def api_rule_action(request):
    """Switch a rule on/off or send a test through it."""
    X.require_admin(request)
    rid = request.match_info["rid"]
    body = await request.json()
    action = body.get("action")
    rule = _STATE["rules"].get(rid)
    if not rule:
        return _err("rule not found", 404)

    if action in ("on", "off"):
        async with _LOCK:
            rule["enabled"] = action == "on"
            _save()
        if rule.get("type") == "entity":
            try:
                await _set_automation_state(rule, rule["enabled"])
            except Exception as exc:
                return _err(exc, 502)
        return web.json_response({"ok": True, "enabled": rule["enabled"]})

    if action == "test":
        title = (rule.get("title") or "").strip() or "🧪 " + rule["name"]
        if "{{" in title:
            title = "🧪 " + rule["name"]
        if rule["type"] == "digest":
            message = _build_digest((rule.get("params") or {}).get("sections")
                                    or [])
        else:
            message = ("This is a test of the rule \"" + rule["name"] +
                       "\". If you can read this, the rule's channels work.")
        async with _LOCK:
            results = await _dispatch(rule, title, message, force=True)
        failed = [r for r in (results or []) if not r["ok"]]
        if failed:
            return _err("; ".join(f"{r['name']}: {r['error']}" for r in failed),
                        502)
        return web.json_response({"ok": True})

    return _err("bad action")


async def api_preview(request):
    """Compile an entity rule to the automation config, for the live preview."""
    X.require_admin(request)
    body = await request.json()
    if body.get("type") != "entity":
        return web.json_response({"config": None})
    err = _validate(body)
    if err:
        return _err(err)
    rule = {"id": str(body.get("id") or "preview"),
            "name": str(body["name"]).strip(),
            "params": body.get("params") or {},
            "title": str(body.get("title") or "").strip(),
            "message": str(body.get("message") or "").strip()}
    return web.json_response({"config": _build_automation(rule)})


async def api_save_settings(request):
    X.require_admin(request)
    body = await request.json()
    async with _LOCK:
        s = _STATE["settings"]
        for key in ("quiet_start", "quiet_end"):
            if key in body:
                value = str(body[key] or "").strip()
                if value and _hhmm_to_minutes(value) is None:
                    return _err("enter times as HH:MM, for example 23:00")
                s[key] = value
        tg = body.get("telegram") or {}
        if "token" in tg:
            token = str(tg["token"] or "").strip()
            if token:                     # blank means "keep the current one"
                s["telegram"]["token"] = token
                _RUNTIME["bot_status"].update({"username": "", "error": ""})
        if tg.get("clear_token"):
            s["telegram"]["token"] = ""
            _RUNTIME["bot_status"].update({"username": "", "running": False})
        if "polling" in tg:
            s["telegram"]["polling"] = bool(tg["polling"])
            _RUNTIME["bot_status"]["username"] = ""
        if "allow_chats" in tg:
            s["telegram"]["allow_chats"] = [
                str(c).strip() for c in (tg["allow_chats"] or [])
                if str(c).strip()]
        if "controls" in tg:
            s["telegram"]["controls"] = [
                str(e) for e in (tg["controls"] or []) if "." in str(e)]
        _save()
    return web.json_response({"ok": True})


async def api_mute(request):
    X.require_admin(request)
    body = await request.json()
    minutes = int(body.get("minutes") or 0)
    async with _LOCK:
        _STATE["settings"]["muted_until"] = _now() + minutes * 60 if minutes else 0
        _save()
    return web.json_response({"ok": True,
                              "muted_until": _STATE["settings"]["muted_until"]})


async def api_bot_test(request):
    """Check the token and report who the bot is."""
    X.require_admin(request)
    ok, me = await _tg_call("getMe", {})
    if not ok:
        return _err(me, 502)
    _RUNTIME["bot_status"].update({"username": (me or {}).get("username", ""),
                                   "error": ""})
    return web.json_response({"ok": True, "username": (me or {}).get("username"),
                              "name": (me or {}).get("first_name")})


async def api_bot_chats(request):
    """Recent chats that messaged the bot — helps users find their chat ID."""
    X.require_admin(request)
    ok, result = await _tg_call("getUpdates", {"offset": -20, "timeout": 0})
    if not ok:
        return _err(result, 502)
    chats, seen = [], set()
    for update in result or []:
        message = update.get("message") or (
            (update.get("callback_query") or {}).get("message") or {})
        chat = message.get("chat") or {}
        cid = chat.get("id")
        if cid is None or cid in seen:
            continue
        seen.add(cid)
        chats.append({
            "id": str(cid),
            "type": chat.get("type"),
            "title": chat.get("title") or " ".join(
                filter(None, [chat.get("first_name"), chat.get("last_name")]))
            or chat.get("username") or str(cid),
        })
    return web.json_response({"chats": chats})


async def api_clear_log(request):
    X.require_admin(request)
    async with _LOCK:
        _STATE["log"] = []
        _save()
    return web.json_response({"ok": True})


# ---------------------------------------------------------------- lifecycle

async def _on_startup(app):
    queue = asyncio.Queue()
    _RUNTIME["queue"] = queue
    for event_type in (NOTIFY_EVENT, "system_log_event", "homeassistant_start"):
        try:
            await X.HA.subscribe_event(event_type, queue)
        except Exception:
            X.log.exception("notify_hub: could not subscribe to %s", event_type)
    _RUNTIME["tasks"] = [
        asyncio.create_task(_event_loop()),
        asyncio.create_task(_scan_loop()),
        asyncio.create_task(_digest_loop()),
        asyncio.create_task(_bot_loop()),
    ]


async def _on_cleanup(app):
    queue = _RUNTIME.get("queue")
    if queue is not None:
        for event_type in (NOTIFY_EVENT, "system_log_event",
                           "homeassistant_start"):
            X.HA.unsubscribe_event(event_type, queue)
    for task in _RUNTIME["tasks"]:
        task.cancel()
    _RUNTIME["tasks"] = []


# ---------------------------------------------------------------- register

def register(app, ctx, manifest):
    global X
    X = ctx
    _load()

    base = "/api/tools/notify_hub"
    app.router.add_get("/tools/notify_hub/", page_tool)

    app.router.add_get(f"{base}/data", api_data)
    app.router.add_post(f"{base}/channels", api_save_channel)
    app.router.add_delete(f"{base}/channels/{{cid}}", api_delete_channel)
    app.router.add_post(f"{base}/channels/{{cid}}/test", api_test_channel)
    app.router.add_post(f"{base}/rules", api_save_rule)
    app.router.add_delete(f"{base}/rules/{{rid}}", api_delete_rule)
    app.router.add_post(f"{base}/rules/{{rid}}/action", api_rule_action)
    app.router.add_post(f"{base}/preview", api_preview)
    app.router.add_post(f"{base}/settings", api_save_settings)
    app.router.add_post(f"{base}/mute", api_mute)
    app.router.add_post(f"{base}/bot/test", api_bot_test)
    app.router.add_get(f"{base}/bot/chats", api_bot_chats)
    app.router.add_post(f"{base}/log/clear", api_clear_log)

    app.on_startup.append(_on_startup)
    app.on_cleanup.append(_on_cleanup)
