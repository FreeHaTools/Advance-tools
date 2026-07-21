"""Security Center — Advance Tools plugin.

A real little alarm panel: live status of doors, windows, motion sensors,
locks, people and cameras, plus a PIN-protected alarm with exit/entry
countdowns, sirens, lights, scripts, TTS and multi-channel push alerts —
all enforced by the add-on itself.

* Security entities are auto-detected from the shared HA state cache
  (binary_sensor device classes, lock.*, person.*, camera.*). Every
  binary_sensor without a security device class is still offered in the
  "other" group so anything (vibration, smoke, …) can be monitored.
* A background task subscribes to the core HAClient listener bus and logs
  open/close/lock/unlock/person events into a persistent ring buffer
  (last 200 events) in /data/security_center.json.
* A second background task ticks once per second and drives the state
  machine: disarmed → arming → armed_* → pending → triggered.
* On trigger it runs the configured actions (sirens, lights, switches,
  locks, scenes, scripts, TTS) and pushes an alert through every
  configured notify channel, optionally with a camera snapshot image.
* Wall tablets can arm/disarm with the PIN through the dashboard-session
  endpoints under /api/dash/security_center/* (no admin login needed),
  gated by the ``allow_dashboards`` switch.
* The PIN is stored as a scrypt hash — same scheme as core user passwords.

Config lives in /data/security_center.json (atomic .tmp + replace, guarded
by the module asyncio lock). Configs written by v1 of this tool are
migrated silently on first load — PIN and event history are preserved.

This is a convenience layer, not a certified alarm system: it only works
while Home Assistant and this add-on are running.
"""
import asyncio
import base64
import hashlib
import hmac
import json
import math
import re
import secrets
import time
from pathlib import Path

import aiohttp
from aiohttp import web

X = None  # core context, injected by the loader
TOOL_DIR = Path(__file__).parent

CORE_API = "http://supervisor/core/api"

EVENT_RING = 200          # events kept in the ring buffer
ALERT_COOLDOWN = 30       # seconds between alerts for the same entity

ARM_MODES = ("home", "away", "night")
ARMED_STATES = ("armed_home", "armed_away", "armed_night")
STATES = ("disarmed", "arming", "armed_home", "armed_away", "armed_night",
          "pending", "triggered")
LEGACY_MODES = ("off", "home", "away", "night")

DOOR_CLASSES = ("door", "garage_door", "opening")
WINDOW_CLASSES = ("window",)
MOTION_CLASSES = ("motion", "occupancy", "presence")

DELAY_LIMITS = {"exit": (0, 300), "entry": (0, 300), "siren": (10, 900)}
DEFAULT_DELAYS = {"exit": 45, "entry": 30, "siren": 180}

ACTION_LISTS = ("sirens", "lights", "switches", "locks", "scenes", "scripts")
ACTION_DOMAINS = {
    "sirens": ("siren.", "switch."),   # switches are often wired as sirens
    "lights": ("light.",),
    "switches": ("switch.",),
    "locks": ("lock.",),
    "scenes": ("scene.",),
    "scripts": ("script.",),
}

ENTITY_RE = re.compile(r"^[a-z0-9_]+\.[a-z0-9_]+$")
NOTIFY_RE = re.compile(r"^notify\.[a-z0-9_]{1,64}$")

DEFAULT_TTS_MESSAGE = "Attention. The security alarm has been triggered."

_LOCK = asyncio.Lock()
_CFG = None                       # cached config (single-process app)
_COOLDOWN = {}                    # entity_id -> last alert timestamp
_SVC_CACHE = {"ts": 0.0, "list": []}
_MONITOR = {"task": None, "listener": None, "ticker": None}

# Runtime-only countdown state (never persisted — a restart clears it).
_RT = {"kind": None, "total": 0, "ends": 0.0, "entity": ""}


def _match_entity(eid):
    return eid.startswith(("binary_sensor.", "lock.", "person."))


# ---------------------------------------------------------------- PIN hashing
# Same scrypt scheme as the core user passwords in main.py.

def _hash_pin(pin: str) -> str:
    salt = secrets.token_bytes(16)
    h = hashlib.scrypt(pin.encode(), salt=salt, n=2 ** 14, r=8, p=1)
    return base64.b64encode(salt).decode() + "$" + base64.b64encode(h).decode()


def _verify_pin(pin: str, stored: str) -> bool:
    try:
        salt_b64, h_b64 = stored.split("$", 1)
        salt = base64.b64decode(salt_b64)
        expect = base64.b64decode(h_b64)
        h = hashlib.scrypt(pin.encode(), salt=salt, n=2 ** 14, r=8, p=1)
        return hmac.compare_digest(h, expect)
    except Exception:
        return False


# ---------------------------------------------------------------- storage

def _cfg_file():
    return X.DATA / "security_center.json"


def _default_actions():
    return {"sirens": [], "lights": [], "switches": [], "locks": [],
            "scenes": [], "scripts": [], "snapshot": True,
            "tts": {"enabled": False, "targets": [],
                    "message": DEFAULT_TTS_MESSAGE}}


def _default_cfg():
    return {
        "pin_hash": None,
        "state": "disarmed",
        "armed_mode": None,
        "sensors": {},          # only user overrides; the rest is auto
        "cameras": None,        # None = auto (every camera.* entity)
        "delays": dict(DEFAULT_DELAYS),
        "actions": _default_actions(),
        "channels": [],
        "allow_dashboards": True,
        "events": [],
        # legacy v1 keys — kept for compatibility, no longer authoritative
        "mode": "off",
        "monitored": None,
        "notify_service": None,
    }


def _migrate(cfg, raw):
    """Bring a v1 config up to the current schema, in place.

    ``raw`` is the dict exactly as read from disk, so we can tell a key
    the user never had (v1) from one that is merely at its default value.
    """
    # notify_service -> channels
    if not cfg.get("channels"):
        ns = cfg.get("notify_service")
        if isinstance(ns, str) and ns.startswith("notify."):
            cfg["channels"] = [ns]

    # monitored {home:[], away:[]} -> sensors
    if not cfg.get("sensors"):
        mon = cfg.get("monitored")
        if isinstance(mon, dict):
            sensors = {}
            for mode in ("home", "away"):
                for eid in (mon.get(mode) or []):
                    if not isinstance(eid, str) or "." not in eid:
                        continue
                    entry = sensors.setdefault(
                        eid, {"use": True, "delay": False, "modes": []})
                    if mode not in entry["modes"]:
                        entry["modes"].append(mode)
            cfg["sensors"] = sensors

    # mode -> state / armed_mode
    if raw.get("state") not in STATES:
        legacy = cfg.get("mode")
        if legacy in ARM_MODES:
            cfg["state"] = "armed_" + legacy
            cfg["armed_mode"] = legacy
        else:
            cfg["state"] = "disarmed"
            cfg["armed_mode"] = None
    return cfg


def _normalize(cfg):
    """Coerce every field into something the rest of the code can trust."""
    if cfg.get("state") not in STATES:
        cfg["state"] = "disarmed"
    if cfg.get("armed_mode") not in ARM_MODES:
        cfg["armed_mode"] = None
    if not isinstance(cfg.get("sensors"), dict):
        cfg["sensors"] = {}
    if cfg.get("cameras") is not None and not isinstance(cfg["cameras"], list):
        cfg["cameras"] = None
    delays = cfg.get("delays")
    if not isinstance(delays, dict):
        delays = {}
    cfg["delays"] = {k: _clamp_delay(k, delays.get(k, DEFAULT_DELAYS[k]))
                     for k in DEFAULT_DELAYS}
    actions = cfg.get("actions")
    if not isinstance(actions, dict):
        actions = {}
    merged = _default_actions()
    for key in ACTION_LISTS:
        val = actions.get(key)
        if isinstance(val, list):
            merged[key] = [e for e in val if isinstance(e, str) and "." in e]
    merged["snapshot"] = bool(actions.get("snapshot", True))
    tts = actions.get("tts")
    if isinstance(tts, dict):
        merged["tts"] = {
            "enabled": bool(tts.get("enabled")),
            "targets": [e for e in (tts.get("targets") or [])
                        if isinstance(e, str) and e.startswith("media_player.")],
            "message": str(tts.get("message") or DEFAULT_TTS_MESSAGE)[:500],
        }
    cfg["actions"] = merged
    cfg["channels"] = [c for c in (cfg.get("channels") or [])
                       if isinstance(c, str) and c.startswith("notify.")]
    cfg["allow_dashboards"] = bool(cfg.get("allow_dashboards", True))
    if not isinstance(cfg.get("events"), list):
        cfg["events"] = []
    if cfg.get("mode") not in LEGACY_MODES:
        cfg["mode"] = "off"
    return cfg


def _clamp_delay(key, value):
    lo, hi = DELAY_LIMITS[key]
    try:
        n = int(value)
    except (TypeError, ValueError):
        return DEFAULT_DELAYS[key]
    return max(lo, min(hi, n))


def _load_cfg():
    """Load (and cache) the config. Call with _LOCK held for mutations."""
    global _CFG
    if _CFG is None:
        cfg = _default_cfg()
        raw = {}
        f = _cfg_file()
        if f.exists():
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    raw = data
                    cfg.update(data)
            except Exception:
                X.log.exception("security_center: could not read %s", f)
        _migrate(cfg, raw)
        _normalize(cfg)
        # A countdown never survives a restart: settle into a stable state.
        if cfg["state"] in ("arming", "pending", "triggered"):
            cfg["state"] = ("armed_" + cfg["armed_mode"]
                            if cfg["armed_mode"] else "disarmed")
        _CFG = cfg
    return _CFG


def _save_cfg():
    """Atomic write. Call with _LOCK held."""
    f = _cfg_file()
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps(_CFG, ensure_ascii=False, indent=2),
                   encoding="utf-8")
    tmp.replace(f)


def _append_event(cfg, entity_id, name, event, mode, alert=False):
    """Append to the ring buffer. Call with _LOCK held; caller saves."""
    cfg["events"].append({"ts": time.time(), "entity_id": entity_id,
                          "name": name, "event": event, "mode": mode,
                          "alert": bool(alert)})
    if len(cfg["events"]) > EVENT_RING:
        del cfg["events"][:len(cfg["events"]) - EVENT_RING]


# ---------------------------------------------------------------- detection

def _slim_item(eid, st):
    attrs = st.get("attributes") or {}
    return {"entity_id": eid,
            "name": attrs.get("friendly_name") or eid,
            "state": st.get("state"),
            "device_class": attrs.get("device_class") or "",
            "last_changed": st.get("last_changed")}


def _choice(eid, st):
    attrs = (st or {}).get("attributes") or {}
    return {"entity_id": eid, "name": attrs.get("friendly_name") or eid}


def _groups():
    """Auto-detect security-relevant entities from the shared state cache.

    ``other`` holds every binary_sensor without a security device class so
    the picker can still offer vibration / smoke / custom sensors.
    """
    g = {"doors": [], "windows": [], "motion": [], "locks": [],
         "people": [], "cameras": [], "other": []}
    for eid, st in sorted(X.HA.states.items()):
        domain = eid.split(".")[0]
        if domain == "binary_sensor":
            dc = (st.get("attributes") or {}).get("device_class") or ""
            if dc in DOOR_CLASSES:
                g["doors"].append(_slim_item(eid, st))
            elif dc in WINDOW_CLASSES:
                g["windows"].append(_slim_item(eid, st))
            elif dc in MOTION_CLASSES:
                g["motion"].append(_slim_item(eid, st))
            else:
                g["other"].append(_slim_item(eid, st))
        elif domain == "lock":
            g["locks"].append(_slim_item(eid, st))
        elif domain == "person":
            g["people"].append(_slim_item(eid, st))
        elif domain == "camera":
            g["cameras"].append(_slim_item(eid, st))
    return g


def _sensor_kind(eid):
    domain = eid.split(".")[0]
    if domain == "lock":
        return "lock"
    st = X.HA.states.get(eid) or {}
    dc = (st.get("attributes") or {}).get("device_class") or ""
    if dc in DOOR_CLASSES:
        return "door"
    if dc in WINDOW_CLASSES:
        return "window"
    if dc in MOTION_CLASSES:
        return "motion"
    return "other"


def _auto_sensors(groups=None):
    """v1-compatible auto monitoring, extended with delays and night mode.

    Doors/windows are monitored in every mode, motion only when away or
    at night. Doors get an entry delay so you can walk in and type a PIN.
    """
    g = groups or _groups()
    out = {}
    for item in g["doors"]:
        out[item["entity_id"]] = {"use": True, "delay": True,
                                  "modes": list(ARM_MODES)}
    for item in g["windows"]:
        out[item["entity_id"]] = {"use": True, "delay": False,
                                  "modes": list(ARM_MODES)}
    for item in g["motion"]:
        out[item["entity_id"]] = {"use": True, "delay": False,
                                  "modes": ["away", "night"]}
    for key in ("other", "locks"):
        for item in g[key]:
            out[item["entity_id"]] = {"use": False, "delay": False,
                                      "modes": list(ARM_MODES)}
    return out


def _effective_sensors(cfg, groups=None):
    """Auto defaults overlaid with the user's saved overrides.

    Every entry carries ``auto`` so the UI can show what is a default.
    """
    out = {}
    for eid, entry in _auto_sensors(groups).items():
        out[eid] = dict(entry, auto=True)
    for eid, entry in (cfg.get("sensors") or {}).items():
        if not isinstance(eid, str) or not isinstance(entry, dict):
            continue
        modes = [m for m in (entry.get("modes") or []) if m in ARM_MODES]
        out[eid] = {"use": bool(entry.get("use")),
                    "delay": bool(entry.get("delay")),
                    "modes": modes, "auto": False}
    for eid, entry in out.items():
        st = X.HA.states.get(eid) or {}
        entry["name"] = _friendly(eid)
        entry["kind"] = _sensor_kind(eid)
        entry["state"] = st.get("state") or "unavailable"
    return out


def _effective_cameras(cfg, groups=None):
    cams = cfg.get("cameras")
    if isinstance(cams, list):
        return [c for c in cams if isinstance(c, str)
                and c.startswith("camera.")]
    g = groups or _groups()
    return [item["entity_id"] for item in g["cameras"]]


def _friendly(eid):
    st = X.HA.states.get(eid) or {}
    return (st.get("attributes") or {}).get("friendly_name") or eid


def _action_choices():
    """Every entity the action picker can offer, grouped by action list."""
    out = {"sirens": [], "lights": [], "switches": [], "locks": [],
           "scenes": [], "scripts": [], "media": []}
    for eid, st in sorted(X.HA.states.items()):
        domain = eid.split(".")[0]
        if domain == "siren":
            out["sirens"].append(_choice(eid, st))
        elif domain == "switch":
            out["switches"].append(_choice(eid, st))
            out["sirens"].append(_choice(eid, st))
        elif domain == "light":
            out["lights"].append(_choice(eid, st))
        elif domain == "lock":
            out["locks"].append(_choice(eid, st))
        elif domain == "scene":
            out["scenes"].append(_choice(eid, st))
        elif domain == "script":
            out["scripts"].append(_choice(eid, st))
        elif domain == "media_player":
            out["media"].append(_choice(eid, st))
    return out


# ---------------------------------------------------------------- countdown

def _start_countdown(kind, seconds, entity=""):
    _RT["kind"] = kind
    _RT["total"] = int(seconds)
    _RT["ends"] = time.monotonic() + int(seconds)
    _RT["entity"] = entity


def _clear_countdown():
    _RT["kind"] = None
    _RT["total"] = 0
    _RT["ends"] = 0.0
    _RT["entity"] = ""


def _remaining():
    if not _RT["kind"]:
        return 0
    return max(0, int(math.ceil(_RT["ends"] - time.monotonic())))


def _countdown_public():
    if not _RT["kind"]:
        return None
    return {"kind": _RT["kind"], "remaining": _remaining(),
            "total": _RT["total"]}


# ---------------------------------------------------------------- state machine
# Every helper below mutates the config with _LOCK held and returns a
# "job" string; the caller runs the matching side effects OUTSIDE the lock
# so a slow service call can never stall the rest of the tool.

def _do_arm(cfg, mode):
    """arm(mode). Returns the new state."""
    delays = cfg["delays"]
    cfg["armed_mode"] = mode
    cfg["mode"] = mode                       # legacy key
    if delays["exit"] > 0 and mode != "home":
        cfg["state"] = "arming"
        _start_countdown("exit", delays["exit"])
        _append_event(cfg, "", "Alarm", "arming", mode)
    else:
        cfg["state"] = "armed_" + mode
        _clear_countdown()
        _append_event(cfg, "", "Alarm", "armed_" + mode, mode)
    _save_cfg()
    return cfg["state"]


def _do_disarm(cfg):
    cfg["state"] = "disarmed"
    cfg["armed_mode"] = None
    cfg["mode"] = "off"                      # legacy key
    _clear_countdown()
    _append_event(cfg, "", "Alarm", "disarmed", "off")
    _save_cfg()


def _do_pending(cfg, entity_id, name):
    cfg["state"] = "pending"
    _start_countdown("entry", cfg["delays"]["entry"], entity_id)
    _append_event(cfg, entity_id, name, "entry_delay",
                  cfg.get("armed_mode") or "", alert=True)
    _save_cfg()


def _do_trigger(cfg, entity_id="", name="Alarm", event="triggered"):
    """Enter the triggered state. Returns False if already triggered."""
    if cfg["state"] == "triggered":
        return False
    cfg["state"] = "triggered"
    _start_countdown("siren", cfg["delays"]["siren"], entity_id)
    _append_event(cfg, entity_id, name, event,
                  cfg.get("armed_mode") or "", alert=True)
    _save_cfg()
    return True


def _do_end_trigger(cfg):
    mode = cfg.get("armed_mode")
    cfg["state"] = "armed_" + mode if mode in ARM_MODES else "disarmed"
    _clear_countdown()
    _append_event(cfg, "", "Alarm", "trigger_ended", mode or "off")
    _save_cfg()


async def _fire_alarm(entity_id, name):
    """Side effects of a trigger: run actions, then push the alerts."""
    cfg = _load_cfg()
    try:
        await _run_actions(cfg)
    except Exception:
        X.log.exception("security_center: running trigger actions failed")
    cam = _snapshot_entity(cfg)
    if entity_id:
        message = f"🚨 ALARM: {name} triggered the alarm"
    else:
        message = "🚨 ALARM triggered"
    try:
        await _send_alerts("🛡️ Security Center", message, cam)
    except Exception:
        X.log.exception("security_center: sending trigger alerts failed")


async def _ticker():
    """One tick per second — drives the exit/entry/siren countdowns."""
    while True:
        await asyncio.sleep(1)
        try:
            await _tick()
        except asyncio.CancelledError:
            raise
        except Exception:
            X.log.exception("security_center: tick failed")


async def _tick():
    if not _RT["kind"] or _remaining() > 0:
        return
    job = None
    entity = _RT["entity"]
    async with _LOCK:
        cfg = _load_cfg()
        kind, state = _RT["kind"], cfg["state"]
        if kind == "exit" and state == "arming":
            mode = cfg.get("armed_mode") or "away"
            cfg["state"] = "armed_" + mode
            _clear_countdown()
            _append_event(cfg, "", "Alarm", "armed_" + mode, mode)
            _save_cfg()
        elif kind == "entry" and state == "pending":
            if _do_trigger(cfg, entity, _friendly(entity) if entity
                           else "Alarm"):
                job = "fire"
        elif kind == "siren" and state == "triggered":
            _do_end_trigger(cfg)
            job = "stop"
        else:
            _clear_countdown()          # countdown no longer applies
    if job == "fire":
        await _fire_alarm(entity, _friendly(entity) if entity else "Alarm")
    elif job == "stop":
        await _stop_actions()


# ---------------------------------------------------------------- actions

async def _svc(domain, service, data=None, target=None):
    """One service call, isolated: a failure never stops the next action."""
    try:
        await X.HA.call_service(domain, service, data, target=target)
        return True
    except Exception:
        X.log.exception("security_center: %s.%s failed (%s)",
                        domain, service, target)
        return False


async def _tts_engine():
    """Pick a TTS engine the same way Announce Center does: a modern
    ``tts.*`` entity first, otherwise a legacy ``<platform>_say`` service."""
    for eid in sorted(X.HA.states):
        if eid.startswith("tts."):
            return ("entity", eid)
    services = {}
    try:
        services = await X.HA.ws_call({"type": "get_services"})
    except Exception:
        X.log.exception("security_center: get_services failed (TTS)")
    for svc in sorted((services or {}).get("tts") or {}):
        if svc.endswith("_say"):
            return ("legacy", svc)
    return None


async def _run_tts(targets, message):
    """Speak on the given media players. Must never break the alarm."""
    try:
        engine = await _tts_engine()
    except Exception:
        X.log.exception("security_center: TTS engine lookup failed")
        return
    if not engine:
        X.log.warning("security_center: no TTS engine available")
        return
    kind, ident = engine
    if kind == "entity":
        await _svc("tts", "speak",
                   {"media_player_entity_id": targets, "message": message,
                    "cache": True}, target={"entity_id": ident})
    else:
        await _svc("tts", ident, {"entity_id": targets, "message": message})


async def _run_actions(cfg):
    """Everything that should happen when the alarm goes off."""
    actions = cfg["actions"]
    for eid in actions["sirens"]:
        if eid.startswith("switch."):
            await _svc("switch", "turn_on", target={"entity_id": eid})
        else:
            await _svc("siren", "turn_on", target={"entity_id": eid})
    for eid in actions["lights"]:
        await _svc("light", "turn_on", target={"entity_id": eid})
    for eid in actions["switches"]:
        await _svc("switch", "turn_on", target={"entity_id": eid})
    for eid in actions["locks"]:
        await _svc("lock", "lock", target={"entity_id": eid})
    for eid in actions["scenes"]:
        await _svc("scene", "turn_on", target={"entity_id": eid})
    for eid in actions["scripts"]:
        await _svc("script", "turn_on", target={"entity_id": eid})
    tts = actions.get("tts") or {}
    if tts.get("enabled") and tts.get("targets"):
        try:
            await _run_tts(list(tts["targets"]),
                           tts.get("message") or DEFAULT_TTS_MESSAGE)
        except Exception:
            X.log.exception("security_center: TTS announcement failed")


async def _stop_actions():
    """Silence the sirens. Lights and locks are deliberately left alone."""
    cfg = _load_cfg()
    for eid in cfg["actions"]["sirens"]:
        if eid.startswith("switch."):
            await _svc("switch", "turn_off", target={"entity_id": eid})
        else:
            await _svc("siren", "turn_off", target={"entity_id": eid})


# ---------------------------------------------------------------- alerts

def _snapshot_entity(cfg):
    """The camera whose snapshot rides along with mobile alerts."""
    if not cfg["actions"].get("snapshot"):
        return None
    cams = _effective_cameras(cfg)
    return cams[0] if cams else None


async def _send_alerts(title, message, snapshot_entity=None):
    """Push one alert through every configured notify channel.

    Returns ``(sent, errors)`` where errors are ``{service, error}`` dicts.
    """
    cfg = _load_cfg()
    channels = list(cfg.get("channels") or [])
    if not channels:
        X.log.warning("security_center: no notify channels configured — "
                      "falling back to persistent_notification")
        channels = ["notify.persistent_notification"]
    sent, errors = [], []
    for channel in channels:
        if not channel.startswith("notify."):
            continue
        service = channel.split(".", 1)[1]
        data = {"title": title, "message": message}
        if snapshot_entity and service.startswith("mobile_app_"):
            data["data"] = {"image": f"/api/camera_proxy/{snapshot_entity}"}
        try:
            await X.HA.call_service("notify", service, data)
            sent.append(channel)
        except Exception as exc:
            X.log.exception("security_center: notify %s failed", channel)
            errors.append({"service": channel, "error": str(exc)})
    return sent, errors


# ---------------------------------------------------------------- monitor task

async def _monitor(queue):
    """Consume state changes pushed by the core HA client."""
    # Wait for the first state dump so change detection can be seeded.
    for _ in range(300):
        if X.HA.states:
            break
        await asyncio.sleep(1)
    last = {eid: st.get("state") for eid, st in X.HA.states.items()
            if _match_entity(eid)}
    X.log.info("security_center: monitor running (%d entities tracked)",
               len(last))
    while True:
        msg = await queue.get()
        try:
            await _handle_change(msg, last)
        except asyncio.CancelledError:
            raise
        except Exception:
            X.log.exception("security_center: event handling failed")


async def _handle_change(msg, last):
    eid = msg.get("entity_id") or ""
    st = msg.get("state") or {}
    new = st.get("state")
    old = last.get(eid)
    last[eid] = new
    if new is None or new == old:
        return                        # attribute-only update — ignore
    domain = eid.split(".")[0]
    name = (st.get("attributes") or {}).get("friendly_name") or eid

    event = None
    tripped = False                   # candidate for an armed alert
    if domain == "binary_sensor":
        kind = _sensor_kind(eid)
        if new == "on":
            event = "motion" if kind == "motion" else "opened"
            tripped = True
        elif new == "off" and kind != "motion":
            event = "closed"          # motion clearing is not worth logging
    elif domain == "lock":
        if new == "locked":
            event = "locked"
        elif new == "unlocked":
            event = "unlocked"
            tripped = True
        elif new == "jammed":
            event = "jammed"
            tripped = True
    elif domain == "person":
        if new == "home":
            event = "arrived"
        elif new == "not_home" and old is not None:
            event = "left"
    if not event:
        return

    job = None
    async with _LOCK:
        cfg = _load_cfg()
        state = cfg["state"]
        mode = cfg.get("armed_mode") or ""
        sensor = _effective_sensors(cfg).get(eid) or {}
        monitored = bool(sensor.get("use")) and mode in (sensor.get("modes")
                                                         or [])
        # During the exit delay ("arming") the user is walking out through
        # their own door — monitored sensors are expected to trip and must
        # never alert or fire the alarm. They are still logged.
        alert = tripped and monitored and state not in ("disarmed", "arming")
        _append_event(cfg, eid, name, event, state, alert=alert)
        _save_cfg()

        if alert and state in ARMED_STATES:
            if sensor.get("delay") and cfg["delays"]["entry"] > 0:
                _do_pending(cfg, eid, name)
                job = "pending"
            elif _do_trigger(cfg, eid, name):
                job = "fire"

    if job == "fire":
        await _fire_alarm(eid, name)
        return
    if job == "pending":
        now = time.time()
        if now - _COOLDOWN.get(eid, 0) < ALERT_COOLDOWN:
            return                    # cooling down — event logged, no push
        _COOLDOWN[eid] = now
        await _send_alerts(
            "🛡️ Security Center",
            f"⏳ {name} opened — entry delay started, disarm now")
        return
    if not alert:
        return

    # Armed but already pending/triggered, or a repeat trip: just notify.
    now = time.time()
    if now - _COOLDOWN.get(eid, 0) < ALERT_COOLDOWN:
        return                        # cooling down — event logged, no push
    _COOLDOWN[eid] = now
    verb = {"opened": "opened", "motion": "detected motion",
            "unlocked": "was unlocked", "jammed": "jammed"}.get(event, event)
    await _send_alerts("🛡️ Security Center",
                       f"🚨 {name} {verb} while armed ({mode or 'armed'})")


async def _start_monitor(app):
    queue = asyncio.Queue()
    listener = (queue, _match_entity)
    X.HA.listeners.add(listener)
    _MONITOR["listener"] = listener
    _MONITOR["task"] = asyncio.create_task(_monitor(queue))
    _MONITOR["ticker"] = asyncio.create_task(_ticker())


async def _stop_monitor(app):
    if _MONITOR["listener"]:
        X.HA.listeners.discard(_MONITOR["listener"])
        _MONITOR["listener"] = None
    for key in ("task", "ticker"):
        task = _MONITOR[key]
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            _MONITOR[key] = None


# ---------------------------------------------------------------- pages

async def page_tool(request):
    if not X.is_admin(request):
        raise web.HTTPFound("/?d=__admin__")
    return web.FileResponse(TOOL_DIR / "static" / "index.html")


# ---------------------------------------------------------------- API helpers

def _err(message, status=400, code=None):
    body = {"error": code or message}
    if code:
        body["message"] = message
    return web.json_response(body, status=status)


async def _notify_services():
    """notify.* services, cached for 60 s to keep the 4 s poll cheap."""
    now = time.time()
    if now - _SVC_CACHE["ts"] < 60:
        return _SVC_CACHE["list"]
    services = []
    if X.HA.connected:
        try:
            result = await X.HA.ws_call({"type": "get_services"})
            for svc in sorted((result or {}).get("notify", {}).keys()):
                if svc == "send_message":
                    continue          # entity-based notify, needs a target
                services.append("notify." + svc)
            _SVC_CACHE["ts"] = now
            _SVC_CACHE["list"] = services
        except Exception:
            X.log.exception("security_center: get_services failed")
            return _SVC_CACHE["list"]
    return services


async def _check_pin(cfg, pin):
    """None when the PIN is good, otherwise a ready-made error response."""
    if not cfg.get("pin_hash"):
        return _err("No PIN has been set yet — create one first.", 409,
                    "no_pin")
    if not _verify_pin(pin, cfg["pin_hash"]):
        return _err("Wrong PIN", 403, "wrong_pin")
    return None


# ---------------------------------------------------------------- API: admin

async def api_overview(request):
    X.require_admin(request)
    groups = _groups()
    async with _LOCK:
        cfg = _load_cfg()
        payload = {
            "connected": X.HA.connected,
            "state": cfg["state"],
            "armed_mode": cfg["armed_mode"],
            "countdown": _countdown_public(),
            "has_pin": bool(cfg.get("pin_hash")),
            "allow_dashboards": cfg["allow_dashboards"],
            "groups": groups,
            "sensors": _effective_sensors(cfg, groups),
            "cameras": _effective_cameras(cfg, groups),
            "delays": dict(cfg["delays"]),
            "actions": json.loads(json.dumps(cfg["actions"])),
            "action_choices": _action_choices(),
            "channels": list(cfg["channels"]),
            "events": cfg["events"][-50:][::-1],
        }
    payload["channel_choices"] = await _notify_services()
    return web.json_response(payload)


async def api_events(request):
    X.require_admin(request)
    async with _LOCK:
        cfg = _load_cfg()
        events = list(reversed(cfg["events"]))
    return web.json_response({"events": events})


async def _arm(body):
    """Shared by the admin and dashboard arm endpoints."""
    mode = body.get("mode")
    pin = str(body.get("pin") or "")
    if mode not in ARM_MODES:
        return _err("mode must be 'home', 'away' or 'night'", 400)
    async with _LOCK:
        cfg = _load_cfg()
        bad = await _check_pin(cfg, pin)
        if bad is not None:
            return bad
        state = _do_arm(cfg, mode)
    return web.json_response({"ok": True, "state": state,
                              "countdown": _countdown_public()})


async def _disarm(body):
    """Shared by the admin and dashboard disarm endpoints."""
    pin = str(body.get("pin") or "")
    async with _LOCK:
        cfg = _load_cfg()
        bad = await _check_pin(cfg, pin)
        if bad is not None:
            return bad
        _do_disarm(cfg)
    await _stop_actions()
    return web.json_response({"ok": True, "state": "disarmed"})


async def api_arm(request):
    X.require_admin(request)
    return await _arm(await request.json())


async def api_disarm(request):
    X.require_admin(request)
    return await _disarm(await request.json())


async def api_panic(request):
    """Trigger the alarm right now, from any state. Admin only, no PIN."""
    X.require_admin(request)
    fired = False
    async with _LOCK:
        cfg = _load_cfg()
        fired = _do_trigger(cfg, "", "Panic", "panic")
    if fired:
        await _fire_alarm("", "Panic button")
    return web.json_response({"ok": True, "state": "triggered",
                              "countdown": _countdown_public()})


async def api_pin(request):
    X.require_admin(request)
    body = await request.json()
    old = str(body.get("old") or "")
    new = str(body.get("new") or "")
    if not new.isdigit() or not 4 <= len(new) <= 8:
        return web.json_response({"error": "The PIN must be 4–8 digits"},
                                 status=400)
    async with _LOCK:
        cfg = _load_cfg()
        if cfg.get("pin_hash"):
            if not old:
                return web.json_response(
                    {"error": "Enter your current PIN to change it"},
                    status=400)
            if not _verify_pin(old, cfg["pin_hash"]):
                return web.json_response(
                    {"error": "The current PIN is wrong"}, status=403)
        cfg["pin_hash"] = _hash_pin(new)
        _save_cfg()
    return web.json_response({"ok": True})


# ---------------------------------------------------------------- API: settings

class _Invalid(Exception):
    """Raised by the validators below with an English message."""


def _valid_sensors(value):
    if not isinstance(value, dict):
        raise _Invalid("sensors must be an object keyed by entity id")
    out = {}
    for eid, entry in value.items():
        if not isinstance(eid, str) or not ENTITY_RE.match(eid):
            raise _Invalid(f"'{eid}' is not a valid entity id")
        if not isinstance(entry, dict):
            raise _Invalid(f"sensor '{eid}' must be an object")
        modes = entry.get("modes")
        if not isinstance(modes, list) or not all(m in ARM_MODES
                                                  for m in modes):
            raise _Invalid(f"sensor '{eid}': modes must be a list of "
                           "'home', 'away' or 'night'")
        out[eid] = {"use": bool(entry.get("use")),
                    "delay": bool(entry.get("delay")),
                    "modes": [m for m in ARM_MODES if m in modes]}
    return out


def _valid_entity_list(value, prefixes, label):
    if not isinstance(value, list):
        raise _Invalid(f"{label} must be a list of entity ids")
    out = []
    for eid in value:
        if not isinstance(eid, str) or not ENTITY_RE.match(eid):
            raise _Invalid(f"{label}: '{eid}' is not a valid entity id")
        if prefixes and not eid.startswith(prefixes):
            allowed = " or ".join(p.rstrip(".") for p in prefixes)
            raise _Invalid(f"{label}: '{eid}' must be a {allowed} entity")
        if eid not in out:
            out.append(eid)
    return out


def _valid_delays(value):
    if not isinstance(value, dict):
        raise _Invalid("delays must be an object")
    out = {}
    for key, (lo, hi) in DELAY_LIMITS.items():
        raw = value.get(key, DEFAULT_DELAYS[key])
        if isinstance(raw, bool) or not isinstance(raw, (int, float)):
            raise _Invalid(f"delays.{key} must be a whole number of seconds")
        num = int(raw)
        if not lo <= num <= hi:
            raise _Invalid(f"delays.{key} must be between {lo} and {hi} "
                           "seconds")
        out[key] = num
    return out


def _valid_actions(value):
    if not isinstance(value, dict):
        raise _Invalid("actions must be an object")
    out = _default_actions()
    for key in ACTION_LISTS:
        if key in value:
            out[key] = _valid_entity_list(value[key], ACTION_DOMAINS[key],
                                          f"actions.{key}")
    out["snapshot"] = bool(value.get("snapshot", True))
    tts = value.get("tts", {})
    if not isinstance(tts, dict):
        raise _Invalid("actions.tts must be an object")
    targets = _valid_entity_list(tts.get("targets") or [], ("media_player.",),
                                 "actions.tts.targets")
    message = str(tts.get("message") or DEFAULT_TTS_MESSAGE).strip()
    if len(message) > 500:
        raise _Invalid("actions.tts.message must be 500 characters or fewer")
    out["tts"] = {"enabled": bool(tts.get("enabled")), "targets": targets,
                  "message": message or DEFAULT_TTS_MESSAGE}
    return out


def _valid_channels(value):
    if not isinstance(value, list):
        raise _Invalid("channels must be a list of notify services")
    out = []
    for ch in value:
        if not isinstance(ch, str) or not NOTIFY_RE.match(ch):
            raise _Invalid(f"channel '{ch}' must look like notify.xyz")
        if ch not in out:
            out.append(ch)
    return out


async def api_settings(request):
    X.require_admin(request)
    try:
        body = await request.json()
    except Exception:
        return _err("invalid JSON body", 400)
    if not isinstance(body, dict):
        return _err("the request body must be an object", 400)
    async with _LOCK:
        cfg = _load_cfg()
        try:
            if "sensors" in body:
                cfg["sensors"] = _valid_sensors(body["sensors"])
            if "cameras" in body:
                cfg["cameras"] = _valid_entity_list(
                    body["cameras"], ("camera.",), "cameras")
            if "delays" in body:
                cfg["delays"] = _valid_delays(body["delays"])
            if "actions" in body:
                cfg["actions"] = _valid_actions(body["actions"])
            if "channels" in body:
                cfg["channels"] = _valid_channels(body["channels"])
                # keep the legacy single-service key roughly in sync
                cfg["notify_service"] = (cfg["channels"][0]
                                         if cfg["channels"] else None)
            if "allow_dashboards" in body:
                cfg["allow_dashboards"] = bool(body["allow_dashboards"])
        except _Invalid as exc:
            return _err(str(exc), 400)
        _save_cfg()
        saved = {
            "sensors": json.loads(json.dumps(cfg["sensors"])),
            "cameras": _effective_cameras(cfg),
            "delays": dict(cfg["delays"]),
            "actions": json.loads(json.dumps(cfg["actions"])),
            "channels": list(cfg["channels"]),
            "allow_dashboards": cfg["allow_dashboards"],
        }
    return web.json_response({"ok": True, **saved})


async def api_test(request):
    """Send a test alert through every configured channel."""
    X.require_admin(request)
    async with _LOCK:
        cfg = _load_cfg()
        cam = _snapshot_entity(cfg)
    sent, errors = await _send_alerts(
        "🛡️ Security Center",
        "✅ This is a test alert from Security Center.", cam)
    return web.json_response({"ok": True, "sent": sent, "errors": errors})


async def api_lock(request):
    X.require_admin(request)
    body = await request.json()
    entity_id = str(body.get("entity_id") or "")
    action = body.get("action")
    if action not in ("lock", "unlock"):
        return web.json_response({"error": "action must be lock or unlock"},
                                 status=400)
    if not entity_id.startswith("lock."):
        return web.json_response({"error": "not a lock entity"}, status=400)
    if entity_id not in X.HA.states:
        return web.json_response({"error": "unknown lock entity"}, status=404)
    try:
        await X.HA.call_service("lock", action,
                                target={"entity_id": entity_id})
    except Exception as exc:
        return web.json_response({"error": str(exc)}, status=502)
    return web.json_response({"ok": True})


async def api_camera(request):
    """Proxy a camera snapshot (JPEG) from HA Core."""
    X.require_admin(request)
    entity_id = request.match_info["entity_id"]
    if not entity_id.startswith("camera."):
        return web.json_response({"error": "not a camera entity"}, status=400)
    if not X.SUPERVISOR_TOKEN:
        return web.json_response({"error": "no HA connection"}, status=503)
    headers = {"Authorization": f"Bearer {X.SUPERVISOR_TOKEN}"}
    try:
        async with aiohttp.ClientSession() as s:
            async with s.get(f"{CORE_API}/camera_proxy/{entity_id}",
                             headers=headers,
                             timeout=aiohttp.ClientTimeout(total=10)) as r:
                if r.status != 200:
                    return web.json_response(
                        {"error": f"camera snapshot failed (HTTP {r.status})"},
                        status=502)
                ctype = (r.headers.get("Content-Type")
                         or "image/jpeg").split(";")[0].strip()
                resp = web.StreamResponse(
                    status=200,
                    headers={"Content-Type": ctype,
                             "Cache-Control": "no-store"})
                await resp.prepare(request)
                async for chunk in r.content.iter_chunked(65536):
                    await resp.write(chunk)
                await resp.write_eof()
                return resp
    except asyncio.TimeoutError:
        return web.json_response({"error": "camera snapshot timed out"},
                                 status=504)
    except aiohttp.ClientError as exc:
        return web.json_response({"error": str(exc)}, status=502)


# ---------------------------------------------------------------- API: dashboard
# Wall-tablet keypad: any logged-in user with access to the dashboard slug
# may arm/disarm with the PIN. No sensor lists, events or settings here.


def _dash_auth(request, slug):
    """Dashboard-session auth: any logged-in user with access to the
    dashboard slug may use the keypad endpoints (NOT admin-gated)."""
    name = X.request_user(request)
    if not name:
        raise web.HTTPUnauthorized(text="not logged in")
    if not X.STORE.can_access(name, slug):
        raise web.HTTPForbidden(text="no access to this dashboard")
    return name


async def _dash_gate_slug(request, slug):
    slug = str(slug or "")
    if not X.SLUG_RE.match(slug):
        raise web.HTTPBadRequest(text="missing or invalid dashboard slug")
    name = _dash_auth(request, slug)
    async with _LOCK:
        cfg = _load_cfg()
        allowed = cfg["allow_dashboards"]
    if not allowed:
        raise web.HTTPForbidden(text="dashboard alarm control is disabled")
    return name, cfg


async def _dash_gate(request):
    return await _dash_gate_slug(request, request.query.get("d", ""))


async def api_dash_state(request):
    await _dash_gate(request)
    async with _LOCK:
        cfg = _load_cfg()
        payload = {"state": cfg["state"], "armed_mode": cfg["armed_mode"],
                   "countdown": _countdown_public(),
                   "has_pin": bool(cfg.get("pin_hash")), "name": "Security"}
    return web.json_response(payload)


async def api_dash_arm(request):
    try:
        body = await request.json()
    except Exception:
        return _err("invalid JSON body", 400)
    await _dash_gate_slug(request, body.get("d", ""))
    return await _arm(body)


async def api_dash_disarm(request):
    try:
        body = await request.json()
    except Exception:
        return _err("invalid JSON body", 400)
    await _dash_gate_slug(request, body.get("d", ""))
    return await _disarm(body)


# ---------------------------------------------------------------- register

def register(app, ctx, manifest):
    global X
    X = ctx
    base = "/api/tools/security_center"
    dash = "/api/dash/security_center"
    app.router.add_get("/tools/security_center/", page_tool)

    app.router.add_get(f"{base}/overview", api_overview)
    app.router.add_get(f"{base}/events", api_events)
    app.router.add_post(f"{base}/arm", api_arm)
    app.router.add_post(f"{base}/disarm", api_disarm)
    app.router.add_post(f"{base}/panic", api_panic)
    app.router.add_post(f"{base}/pin", api_pin)
    app.router.add_post(f"{base}/settings", api_settings)
    app.router.add_post(f"{base}/test", api_test)
    app.router.add_post(f"{base}/lock", api_lock)
    app.router.add_get(f"{base}/camera/{{entity_id}}", api_camera)

    # dashboard-session keypad endpoints (NOT admin-gated)
    app.router.add_get(f"{dash}/state", api_dash_state)
    app.router.add_post(f"{dash}/arm", api_dash_arm)
    app.router.add_post(f"{dash}/disarm", api_dash_disarm)

    app.on_startup.append(_start_monitor)
    app.on_cleanup.append(_stop_monitor)
