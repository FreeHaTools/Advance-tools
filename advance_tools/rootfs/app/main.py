"""Advance Tools — plugin-based smart home toolbox for Home Assistant.

Runs as an HA add-on. The core provides authentication (users/sessions), a
shared WebSocket connection to HA Core, the admin hub, and a tool loader.
Every feature (Dashboard Maker, Automation Maker, …) is a tool plugin living
in app/tools/<id>/ with a manifest.json + tool.py that registers its routes.

Copyright (C) 2026 Mike Fattahi <https://www.fattahi.us>
SPDX-License-Identifier: GPL-3.0-or-later

This program is free software: you can redistribute it and/or modify it
under the terms of the GNU General Public License as published by the Free
Software Foundation, either version 3 of the License, or (at your option)
any later version. It is distributed WITHOUT ANY WARRANTY; see the LICENSE
file at the root of the repository for the full text.
"""
import asyncio
import base64
import hashlib
import hmac
import importlib.util
import json
import logging
import os
import re
import secrets
import time
from pathlib import Path
from types import SimpleNamespace

import aiohttp
from aiohttp import WSMsgType, web

log = logging.getLogger("advance_tools")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

VERSION = "1.0.0"  # keep in sync with config.yaml
START_TIME = time.time()

# ---------------------------------------------------------------- paths / env
DATA = Path(os.environ.get("DATA_DIR", "/data"))
APP = Path(os.environ.get("APP_DIR", os.path.dirname(os.path.abspath(__file__))))
CONF_FILE = DATA / "panel.json"          # users, dashboards and settings
SECRET_FILE = DATA / "secret.key"

PORT = int(os.environ.get("PORT", "8234"))
SUPERVISOR_TOKEN = os.environ.get("SUPERVISOR_TOKEN", "")
HA_WS_URL = os.environ.get("HA_WS_URL", "ws://supervisor/core/websocket")

SLUG_RE = re.compile(r"^[a-z0-9_]{1,40}$")
SESSION_DAYS_USER = 365   # kiosk tablets must stay logged in
SESSION_DAYS_ADMIN = 7
COOKIE = "at_session"     # session cookie name
INGRESS_PORT = 8099       # HA sidebar (ingress) — serves a launcher page


def _public_domain():
    domain = os.environ.get("DOMAIN", "").strip().rstrip("/")
    if not domain or domain == "null":
        return ""
    if "://" not in domain:
        domain = "https://" + domain
    return domain

# ---------------------------------------------------------------- store

class Store:
    """users/dashboards/settings config in /data/panel.json."""

    def __init__(self):
        self.lock = asyncio.Lock()
        self.data = {"users": {}, "dashboards": {}, "settings": {}}
        # True when panel.json existed but predates the "settings" section, i.e.
        # an installation from before the guided setup was added.
        self.legacy_install = False

    def load(self):
        if CONF_FILE.exists():
            self.data = json.loads(CONF_FILE.read_text(encoding="utf-8"))
            self.legacy_install = "settings" not in self.data
        self.data.setdefault("users", {})
        self.data.setdefault("dashboards", {})
        self.data.setdefault("settings", {})

    def save(self):
        tmp = CONF_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.data, ensure_ascii=False, indent=2),
                       encoding="utf-8")
        tmp.replace(CONF_FILE)

    # -- users
    def user(self, name):
        return self.data["users"].get(name)

    def user_dashboards(self, name):
        u = self.user(name)
        if not u:
            return []
        if u.get("is_admin") or "*" in u.get("dashboards", []):
            return list(self.data["dashboards"].keys())
        return [d for d in u.get("dashboards", []) if d in self.data["dashboards"]]

    def can_access(self, name, slug):
        return slug in self.user_dashboards(name)


STORE = Store()

# ---------------------------------------------------------------- passwords / sessions

def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    h = hashlib.scrypt(password.encode(), salt=salt, n=2 ** 14, r=8, p=1)
    return base64.b64encode(salt).decode() + "$" + base64.b64encode(h).decode()


MIN_PASSWORD_LEN = 8
WEAK_PASSWORDS = {
    "admin", "password", "12345678", "123456789", "1234567890",
    "administrator", "changeme", "letmein", "qwertyui", "homeassistant",
}


def check_password(password: str, username: str = ""):
    """Validate a *new* password. Returns None when fine, else an error string.

    Single source of truth for the password rules — used by the setup wizard,
    the self-service change endpoint and admin account creation.
    """
    password = password or ""
    if len(password) < MIN_PASSWORD_LEN:
        return f"Password must be at least {MIN_PASSWORD_LEN} characters"
    if password.lower() in WEAK_PASSWORDS:
        return "That password is too common — please choose another one"
    if username and password.lower() == username.lower():
        return "Password must not be the same as the username"
    return None


def get_setting(key, default=None):
    """Read a value from the persisted settings section."""
    return STORE.data.get("settings", {}).get(key, default)


def set_setting(key, value):
    """Write a value to the persisted settings section and save the store."""
    STORE.data.setdefault("settings", {})[key] = value
    STORE.save()


def setup_done() -> bool:
    return bool(get_setting("setup_done"))


def verify_password(password: str, stored: str) -> bool:
    try:
        salt_b64, h_b64 = stored.split("$", 1)
        salt = base64.b64decode(salt_b64)
        expect = base64.b64decode(h_b64)
        h = hashlib.scrypt(password.encode(), salt=salt, n=2 ** 14, r=8, p=1)
        return hmac.compare_digest(h, expect)
    except Exception:
        return False


def _secret() -> bytes:
    if not SECRET_FILE.exists():
        SECRET_FILE.write_bytes(secrets.token_bytes(32))
    return SECRET_FILE.read_bytes()


def make_token(username: str, days: int) -> str:
    payload = json.dumps({"u": username, "exp": int(time.time()) + days * 86400})
    b = base64.urlsafe_b64encode(payload.encode()).decode()
    sig = hmac.new(_secret(), b.encode(), hashlib.sha256).hexdigest()
    return f"{b}.{sig}"


def parse_token(token: str):
    try:
        b, sig = token.rsplit(".", 1)
        good = hmac.new(_secret(), b.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, good):
            return None
        payload = json.loads(base64.urlsafe_b64decode(b.encode()))
        if payload.get("exp", 0) < time.time():
            return None
        return payload.get("u")
    except Exception:
        return None


def request_user(request):
    token = request.cookies.get(COOKIE)
    if not token:
        return None
    name = parse_token(token)
    if name and STORE.user(name):
        return name
    return None


def require_admin(request):
    name = request_user(request)
    if not name or not STORE.user(name).get("is_admin"):
        raise web.HTTPForbidden(text="admin required")
    return name


def _is_admin(request):
    name = request_user(request)
    return bool(name and STORE.user(name) and STORE.user(name).get("is_admin"))


def must_change(name) -> bool:
    """True when this account is still on a temporary password."""
    u = STORE.user(name) if name else None
    return bool(u and u.get("must_change_password"))


def _session_days(user) -> int:
    return SESSION_DAYS_ADMIN if user.get("is_admin") else SESSION_DAYS_USER


def _set_session(resp, username, days):
    resp.set_cookie(COOKIE, make_token(username, days), max_age=days * 86400,
                    httponly=True, samesite="Lax", path="/")
    return resp

# ---------------------------------------------------------------- security log

SECURITY_LOG = []          # newest last; capped at SECURITY_LOG_MAX
SECURITY_LOG_MAX = 200


def log_security(event, username="", ip="", detail=""):
    """Record a security event.

    Deliberately in-memory only: the log is cleared on every add-on restart and
    is never written to disk, so it can never leak credentials into /data.
    Never pass a password or a token as `detail`.
    """
    SECURITY_LOG.append({"ts": int(time.time()), "event": event,
                         "username": username, "ip": ip, "detail": detail})
    if len(SECURITY_LOG) > SECURITY_LOG_MAX:
        del SECURITY_LOG[:-SECURITY_LOG_MAX]


def client_ip(request) -> str:
    """Real client IP — this add-on usually sits behind nginx."""
    fwd = request.headers.get("X-Forwarded-For", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.remote or "?"

# ---------------------------------------------------------------- login throttle

LOGIN_FAILS = {}                       # (username, ip) -> {n, until, seen}
LOGIN_FAIL_LIMIT = 5                   # failures allowed before locking
LOCKOUT_STEPS = (30, 120, 300, 900)    # escalating backoff, capped at 15 min
LOGIN_FAIL_TTL = 3600                  # forget a key after an hour of silence


def _prune_login_fails(now):
    if len(LOGIN_FAILS) < 64:
        return
    for key, rec in list(LOGIN_FAILS.items()):
        if now - rec["seen"] > LOGIN_FAIL_TTL:
            LOGIN_FAILS.pop(key, None)


def login_lock_remaining(username, ip) -> int:
    """Seconds left on the lockout for this (user, ip), 0 when not locked."""
    rec = LOGIN_FAILS.get((username, ip))
    if not rec:
        return 0
    left = int(rec["until"] - time.time())
    return left if left > 0 else 0


def note_login_failure(username, ip) -> int:
    """Count a failed attempt; returns the lockout seconds applied (0 if none)."""
    now = time.time()
    _prune_login_fails(now)
    rec = LOGIN_FAILS.setdefault((username, ip), {"n": 0, "until": 0.0, "seen": now})
    rec["n"] += 1
    rec["seen"] = now
    if rec["n"] < LOGIN_FAIL_LIMIT:
        return 0
    step = LOCKOUT_STEPS[min(rec["n"] - LOGIN_FAIL_LIMIT, len(LOCKOUT_STEPS) - 1)]
    rec["until"] = now + step
    return step


def clear_login_failures(username, ip):
    LOGIN_FAILS.pop((username, ip), None)

# ---------------------------------------------------------------- HA client

class HAClient:
    """Single WebSocket connection to HA Core, shared by all tools."""

    def __init__(self):
        self.states = {}                 # entity_id -> {state, attributes, last_changed}
        self.listeners = set()           # (queue, matcher) — state_changed only
        self.event_listeners = {}        # event_type -> set of queues
        self.connected = False
        self.ha_version = ""
        self._ws = None
        self._id = 0
        self._pending = {}

    @staticmethod
    def _slim(state_obj):
        return {
            "state": state_obj.get("state"),
            "attributes": state_obj.get("attributes", {}),
            "last_changed": state_obj.get("last_changed"),
        }

    async def run(self):
        if not SUPERVISOR_TOKEN:
            log.warning("No SUPERVISOR_TOKEN — running without HA connection (dev mode)")
            return
        while True:
            try:
                await self._connect_once()
            except Exception as exc:
                log.warning("HA connection lost: %s — retrying in 5s", exc)
            self.connected = False
            await asyncio.sleep(5)

    async def _connect_once(self):
        async with aiohttp.ClientSession() as session:
            async with session.ws_connect(HA_WS_URL, heartbeat=30) as ws:
                self._ws = ws
                msg = await ws.receive_json()          # auth_required
                if msg.get("type") != "auth_required":
                    raise RuntimeError(f"unexpected: {msg}")
                await ws.send_json({"type": "auth", "access_token": SUPERVISOR_TOKEN})
                msg = await ws.receive_json()
                if msg.get("type") != "auth_ok":
                    raise RuntimeError(f"auth failed: {msg}")
                self.ha_version = msg.get("ha_version", "")

                # The receive loop must be running BEFORE we await any command
                # result — otherwise the result is never read and _call times out.
                recv_task = asyncio.create_task(self._recv_loop(ws))
                try:
                    states = await self._call({"type": "get_states"})
                    self.states = {s["entity_id"]: self._slim(s) for s in states}
                    await self._call({"type": "subscribe_events",
                                      "event_type": "state_changed"})
                    # re-subscribe anything tools asked for before/after a drop
                    for event_type in list(self.event_listeners):
                        try:
                            await self._call({"type": "subscribe_events",
                                              "event_type": event_type})
                        except Exception:
                            log.exception("re-subscribe to %s failed", event_type)
                    self.connected = True
                    log.info("Connected to Home Assistant %s (%d entities)",
                             self.ha_version, len(self.states))
                    await recv_task          # runs until the socket closes
                finally:
                    recv_task.cancel()

    async def _recv_loop(self, ws):
        async for raw in ws:
            if raw.type != WSMsgType.TEXT:
                break
            msg = raw.json()
            if msg.get("type") == "result":
                fut = self._pending.pop(msg.get("id"), None)
                if fut and not fut.done():
                    if msg.get("success"):
                        fut.set_result(msg.get("result"))
                    else:
                        fut.set_exception(RuntimeError(str(msg.get("error"))))
            elif msg.get("type") == "event":
                event = msg.get("event", {}) or {}
                data = event.get("data", {}) or {}
                event_type = event.get("event_type")

                if event_type and event_type != "state_changed":
                    for queue in list(self.event_listeners.get(event_type, ())):
                        queue.put_nowait({"type": "event",
                                          "event_type": event_type,
                                          "data": data,
                                          "time_fired": event.get("time_fired")})
                    continue

                eid = data.get("entity_id")
                new = data.get("new_state")
                if not eid:
                    continue
                if new is None:
                    self.states.pop(eid, None)
                    continue
                self.states[eid] = self._slim(new)
                for queue, matcher in list(self.listeners):
                    if matcher(eid):
                        queue.put_nowait({"type": "state", "entity_id": eid,
                                          "state": self.states[eid]})

    async def _call(self, message: dict):
        self._id += 1
        message["id"] = self._id
        fut = asyncio.get_event_loop().create_future()
        self._pending[self._id] = fut
        await self._ws.send_json(message)
        return await asyncio.wait_for(fut, 15)

    async def ws_call(self, message: dict):
        """Public WS command for tools (get_services, get_config, …)."""
        if not self.connected:
            raise RuntimeError("not connected to Home Assistant")
        return await self._call(dict(message))

    async def subscribe_event(self, event_type: str, queue: asyncio.Queue):
        """Listen to any HA event type (not state_changed).

        Tools pass an asyncio.Queue and receive
        {"type": "event", "event_type": ..., "data": ..., "time_fired": ...}.
        Safe to call while disconnected — the subscription is (re)sent as soon
        as the WebSocket comes up. Use unsubscribe_event() on cleanup.
        """
        first = event_type not in self.event_listeners
        self.event_listeners.setdefault(event_type, set()).add(queue)
        if first and self.connected:
            await self._call({"type": "subscribe_events",
                              "event_type": event_type})

    def unsubscribe_event(self, event_type: str, queue: asyncio.Queue):
        queues = self.event_listeners.get(event_type)
        if not queues:
            return
        queues.discard(queue)
        if not queues:
            self.event_listeners.pop(event_type, None)

    async def call_service(self, domain, service, service_data=None, target=None):
        if not self.connected:
            raise RuntimeError("not connected to Home Assistant")
        msg = {"type": "call_service", "domain": domain, "service": service}
        if service_data:
            msg["service_data"] = service_data
        if target:
            msg["target"] = target
        return await self._call(msg)


HA = HAClient()

# ---------------------------------------------------------------- routes: pages

async def page_login(request):
    if not setup_done():
        raise web.HTTPFound("/setup")
    return web.FileResponse(APP / "static" / "login.html")


async def page_setup(request):
    """First-run wizard — set a real admin password before anything else."""
    f = APP / "static" / "setup.html"
    if not f.is_file():
        return web.Response(
            text="Setup page is missing from this installation.\n"
                 "Reinstall or update the Advance Tools add-on, then reload "
                 "this page.\n",
            content_type="text/plain", status=200)
    return web.FileResponse(f)


async def page_hub(request):
    """The Advance Tools hub — the new admin panel."""
    if not _is_admin(request):
        raise web.HTTPFound("/?d=__admin__")
    return web.FileResponse(APP / "static" / "hub.html")


async def health(request):
    return web.json_response({"ok": True, "ha_connected": HA.connected})

# ---------------------------------------------------------------- routes: PWA


async def page_manifest(request):
    """Web app manifest.

    Served from an explicit route so the content type is always
    application/manifest+json — the static handler guesses from the file
    extension and browsers reject a manifest sent as octet-stream.
    """
    body = (APP / "static" / "manifest.webmanifest").read_text(encoding="utf-8")
    return web.Response(text=body, content_type="application/manifest+json",
                        headers={"Cache-Control": "no-cache, must-revalidate"})


async def page_sw(request):
    """Service worker, served from the site root.

    Root scope is what lets a worker registered from /admin also cover / and
    /static/. VERSION is substituted into the file so every add-on release
    produces a new cache name and the old cache is evicted on activate.
    """
    js = (APP / "static" / "sw.js").read_text(encoding="utf-8")
    return web.Response(text=js.replace("{{VERSION}}", VERSION),
                        content_type="application/javascript",
                        headers={"Service-Worker-Allowed": "/",
                                 "Cache-Control": "no-cache, must-revalidate"})

# ---------------------------------------------------------------- routes: auth API

async def api_dashboards(request):
    """Public: names for the login dropdown."""
    dashes = [{"slug": s, "name": d.get("name", s)}
              for s, d in STORE.data["dashboards"].items()]
    dashes.sort(key=lambda d: d["name"])
    return web.json_response(dashes)


async def api_login(request):
    body = await request.json()
    username = str(body.get("username", "")).strip()
    password = str(body.get("password", ""))
    dashboard = body.get("dashboard")  # slug or "__admin__"
    ip = client_ip(request)

    left = login_lock_remaining(username, ip)
    if left:
        return web.json_response(
            {"error": f"Too many failed attempts — try again in {left} seconds",
             "retry_after": left}, status=429,
            headers={"Retry-After": str(left)})

    user = STORE.user(username)
    if not user or not verify_password(password, user.get("password", "")):
        lock = note_login_failure(username, ip)
        log_security("login_failed", username, ip)
        if lock:
            log_security("lockout", username, ip, f"locked for {lock}s")
            log.warning("Login lockout for %r from %s (%ds)", username, ip, lock)
            return web.json_response(
                {"error": f"Too many failed attempts — try again in {lock} seconds",
                 "retry_after": lock}, status=429,
                headers={"Retry-After": str(lock)})
        return web.json_response({"error": "Wrong username or password"}, status=401)

    clear_login_failures(username, ip)
    log_security("login_ok", username, ip)

    # Still on a temporary password: hand out a session but force the wizard.
    if user.get("must_change_password"):
        resp = web.json_response({"ok": True, "must_change": True, "url": "/setup"})
        return _set_session(resp, username, _session_days(user))

    if dashboard == "__admin__":
        if not user.get("is_admin"):
            return web.json_response({"error": "This user is not an admin"}, status=403)
        url = "/admin"
        days = SESSION_DAYS_ADMIN
    else:
        if dashboard not in STORE.data["dashboards"]:
            return web.json_response({"error": "Dashboard not found"}, status=404)
        if not STORE.can_access(username, dashboard):
            return web.json_response(
                {"error": "You don't have access to this dashboard"}, status=403)
        url = f"/d/{dashboard}/"
        days = SESSION_DAYS_ADMIN if user.get("is_admin") else SESSION_DAYS_USER

    resp = web.json_response({"ok": True, "url": url})
    return _set_session(resp, username, days)


async def api_logout(request):
    resp = web.json_response({"ok": True})
    resp.del_cookie(COOKIE, path="/")
    return resp


async def api_me(request):
    name = request_user(request)
    if not name:
        return web.json_response({"error": "not logged in"}, status=401)
    u = STORE.user(name)
    return web.json_response({"username": name, "is_admin": bool(u.get("is_admin")),
                              "dashboards": STORE.user_dashboards(name),
                              "must_change": bool(u.get("must_change_password"))})

# ---------------------------------------------------------------- routes: setup


async def api_setup_state(request):
    """Public setup state — must not leak anything useful to an attacker."""
    done = setup_done()
    admin = STORE.user("admin") or {}
    out = {"setup_done": done,
           "needs_password": bool(not done or admin.get("must_change_password"))}
    if not done:
        out["username"] = "admin"
    else:
        name = request_user(request)
        if must_change(name):          # own account, so not a leak
            out["username"] = name
    return web.json_response(out)


async def api_setup_password(request):
    """Set the password during first-run setup, or for a flagged account."""
    name = request_user(request)
    if must_change(name):
        target = name
    elif not setup_done():
        target = "admin"
    else:
        return web.json_response({"error": "Setup is already complete"}, status=403)

    user = STORE.user(target)
    if not user:
        return web.json_response({"error": "Account not found"}, status=404)

    body = await request.json()
    password = str(body.get("password", ""))
    problem = check_password(password, target)
    if problem:
        return web.json_response({"error": problem}, status=400)

    async with STORE.lock:
        user["password"] = hash_password(password)
        user.pop("must_change_password", None)
        STORE.save()
    log_security("password_changed", target, client_ip(request), "setup wizard")
    log.info("Password set for %r via the setup wizard", target)

    # Fresh session so the wizard can continue into authenticated steps.
    resp = web.json_response({"ok": True})
    return _set_session(resp, target, _session_days(user))


async def api_setup_finish(request):
    """Mark the guided setup as complete (admin session required)."""
    name = require_admin(request)
    if must_change(name):
        return web.json_response({"error": "Set a new password first"}, status=400)
    async with STORE.lock:
        STORE.data["settings"]["setup_done"] = True
        STORE.save()
    log_security("setup_completed", name, client_ip(request))
    log.info("Initial setup completed by %r", name)
    return web.json_response({"ok": True})


async def api_me_password(request):
    """Any logged-in user changes their own password."""
    name = request_user(request)
    if not name:
        return web.json_response({"error": "not logged in"}, status=401)
    user = STORE.user(name)
    body = await request.json()
    old = str(body.get("old", ""))
    new = str(body.get("new", ""))
    if not verify_password(old, user.get("password", "")):
        log_security("password_change_failed", name, client_ip(request),
                     "wrong current password")
        return web.json_response({"error": "Current password is wrong"}, status=403)
    problem = check_password(new, name)
    if problem:
        return web.json_response({"error": problem}, status=400)
    async with STORE.lock:
        user["password"] = hash_password(new)
        user.pop("must_change_password", None)
        STORE.save()
    log_security("password_changed", name, client_ip(request), "self service")
    return web.json_response({"ok": True})

# ---------------------------------------------------------------- routes: core admin API

async def admin_get_config(request):
    require_admin(request)
    users = {n: {"is_admin": bool(u.get("is_admin")),
                 "dashboards": u.get("dashboards", [])}
             for n, u in STORE.data["users"].items()}
    return web.json_response({"users": users, "dashboards": STORE.data["dashboards"],
                              "ha_connected": HA.connected, "domain": _public_domain()})


async def admin_save_user(request):
    require_admin(request)
    body = await request.json()
    username = str(body.get("username", "")).strip()
    if not re.match(r"^[a-zA-Z0-9_.-]{1,40}$", username):
        return web.json_response({"error": "invalid username"}, status=400)
    async with STORE.lock:
        existing = STORE.user(username)
        password = body.get("password") or ""
        if not existing and not password:
            return web.json_response({"error": "password required for new user"},
                                     status=400)
        user = existing or {}
        if password:
            # Admin accounts can unlock doors and disarm the alarm, so their
            # passwords must pass the policy. Kiosk/dashboard users keep the
            # old freedom (short PINs on tablets).
            if body.get("is_admin"):
                problem = check_password(password, username)
                if problem:
                    return web.json_response({"error": problem}, status=400)
            user["password"] = hash_password(password)
            user.pop("must_change_password", None)
        user["is_admin"] = bool(body.get("is_admin"))
        user["dashboards"] = body.get("dashboards", [])
        STORE.data["users"][username] = user
        STORE.save()
    return web.json_response({"ok": True})


async def admin_delete_user(request):
    admin = require_admin(request)
    username = request.match_info["username"]
    if username == "admin":
        return web.json_response(
            {"error": "the built-in admin account cannot be deleted — only edited"},
            status=400)
    if username == admin:
        return web.json_response({"error": "cannot delete yourself"}, status=400)
    async with STORE.lock:
        STORE.data["users"].pop(username, None)
        STORE.save()
    return web.json_response({"ok": True})


async def admin_entities(request):
    """Entity list — shared by every tool's entity pickers."""
    require_admin(request)
    items = []
    for eid, st in sorted(HA.states.items()):
        attrs = st.get("attributes") or {}
        items.append({
            "id": eid,
            "name": attrs.get("friendly_name") or eid,
            "domain": eid.split(".")[0],
            "state": st.get("state"),
            "unit": attrs.get("unit_of_measurement") or "",
        })
    return web.json_response({"entities": items, "connected": HA.connected})


async def api_security_log(request):
    """Recent security events, newest first (in-memory, lost on restart)."""
    require_admin(request)
    return web.json_response({"events": list(reversed(SECURITY_LOG))})


async def api_tools(request):
    """Installed tool manifests for the hub."""
    require_admin(request)
    return web.json_response({"tools": TOOLS})


async def api_system(request):
    """System overview for the hub's home page."""
    require_admin(request)
    domains = {}
    for eid in HA.states:
        d = eid.split(".")[0]
        domains[d] = domains.get(d, 0) + 1
    top = sorted(domains.items(), key=lambda kv: -kv[1])[:8]
    return web.json_response({
        "app": "Advance Tools",
        "version": VERSION,
        "uptime": int(time.time() - START_TIME),
        "ha_connected": HA.connected,
        "ha_version": HA.ha_version,
        "entities": len(HA.states),
        "domains": len(domains),
        "top_domains": [{"domain": d, "count": c} for d, c in top],
        "automations": domains.get("automation", 0),
        "users": len(STORE.data["users"]),
        "admins": sum(1 for u in STORE.data["users"].values() if u.get("is_admin")),
        "dashboards": len(STORE.data["dashboards"]),
        "tools": len(TOOLS),
        "domain": _public_domain(),
    })

# ---------------------------------------------------------------- tool loader

TOOLS = []          # manifests of successfully loaded tools


def load_tools(app):
    """Import every tool in app/tools/<id>/ and let it register its routes."""
    ctx = SimpleNamespace(
        STORE=STORE, HA=HA, DATA=DATA, APP=APP, log=log,
        SLUG_RE=SLUG_RE, SUPERVISOR_TOKEN=SUPERVISOR_TOKEN, VERSION=VERSION,
        require_admin=require_admin, request_user=request_user,
        is_admin=_is_admin,
        # settings + auth helpers (added in 2.15)
        get_setting=get_setting, set_setting=set_setting,
        hash_password=hash_password, verify_password=verify_password,
        check_password=check_password, log_security=log_security,
        client_ip=client_ip, COOKIE=COOKIE,
    )
    tdir = APP / "tools"
    if not tdir.is_dir():
        return
    for sub in sorted(tdir.iterdir()):
        mf = sub / "manifest.json"
        py = sub / "tool.py"
        if not (sub.is_dir() and mf.is_file() and py.is_file()):
            continue
        try:
            manifest = json.loads(mf.read_text(encoding="utf-8"))
            manifest["id"] = manifest.get("id") or sub.name
            spec = importlib.util.spec_from_file_location(
                f"at_tool_{sub.name}", py)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            mod.register(app, ctx, manifest)
            static = sub / "static"
            if static.is_dir():
                app.router.add_static(f"/tools/{manifest['id']}/static/", static)
            TOOLS.append(manifest)
            log.info("Loaded tool: %s v%s", manifest.get("name", sub.name),
                     manifest.get("version", "?"))
        except Exception:
            log.exception("Failed to load tool %r — skipping", sub.name)

# ---------------------------------------------------------------- bootstrap / app

def bootstrap():
    DATA.mkdir(parents=True, exist_ok=True)
    STORE.load()
    settings = STORE.data["settings"]

    if not STORE.data["users"]:
        # Fresh install — temporary credentials, guided setup required.
        STORE.data["users"]["admin"] = {
            "password": hash_password("admin"),
            "is_admin": True,
            "dashboards": ["*"],
            "must_change_password": True,
        }
        settings["setup_done"] = False
        STORE.save()
        log.warning("Fresh install: temporary account admin/admin created. "
                    "Open the panel and finish setup — the login page is "
                    "locked to the setup wizard until a real password is set.")
    elif STORE.legacy_install:
        # Upgrade from a version without guided setup: never drop a working
        # installation into the wizard, only nudge if the password is still
        # the shipped default.
        settings["setup_done"] = True
        admin = STORE.user("admin")
        if admin and verify_password("admin", admin.get("password", "")):
            admin["must_change_password"] = True
            log.warning("The 'admin' account still uses the default password — "
                        "you will be asked to change it at the next login.")
        STORE.save()
    else:
        settings.setdefault("setup_done", True)

    if not settings.get("setup_done"):
        log.warning("Setup is not complete — every visit is redirected to /setup")
    stale = [n for n, u in STORE.data["users"].items()
             if u.get("must_change_password")]
    if stale:
        log.warning("SECURITY: temporary password in use for account(s): %s",
                    ", ".join(sorted(stale)))


@web.middleware
async def nocache_mw(request, handler):
    """Static files change on every add-on update — never let tablets/browsers
    keep stale JS, or the designer and dashboards break in confusing ways."""
    resp = await handler(request)
    if (request.path.startswith(("/static/", "/admin", "/d/", "/tools/", "/setup"))
            or request.path == "/"):
        resp.headers["Cache-Control"] = "no-cache, must-revalidate"
    return resp


@web.middleware
async def ingress_mw(request, handler):
    """Requests arriving on the ingress port come from HA's sidebar (already
    authenticated by Home Assistant, admins only via panel_admin). Serve a
    small launcher page that opens the hub full-window — the app's own pages
    use absolute paths and can't run under the ingress prefix."""
    sock = request.transport.get_extra_info("sockname") if request.transport else None
    if sock and sock[1] == INGRESS_PORT:
        html = (APP / "static" / "ingress.html").read_text(encoding="utf-8")
        return web.Response(text=html.replace("{{DOMAIN}}", _public_domain()),
                            content_type="text/html",
                            headers={"Cache-Control": "no-cache"})
    return await handler(request)


def build_app():
    app = web.Application(client_max_size=100 * 1024 * 1024,
                          middlewares=[ingress_mw, nocache_mw])
    # core pages
    app.router.add_get("/", page_login)
    app.router.add_get("/panel", page_login)
    app.router.add_get("/admin", page_hub)
    app.router.add_get("/setup", page_setup)
    app.router.add_get("/health", health)

    # PWA (installable web app) — both are plain static assets with a hand-set
    # content type; neither touches auth or any existing route.
    app.router.add_get("/manifest.webmanifest", page_manifest)
    app.router.add_get("/sw.js", page_sw)

    # core auth
    app.router.add_get("/api/dashboards", api_dashboards)
    app.router.add_post("/api/login", api_login)
    app.router.add_post("/api/logout", api_logout)
    app.router.add_get("/api/me", api_me)
    app.router.add_post("/api/me/password", api_me_password)

    # first-run setup
    app.router.add_get("/api/setup/state", api_setup_state)
    app.router.add_post("/api/setup/password", api_setup_password)
    app.router.add_post("/api/setup/finish", api_setup_finish)

    # core admin
    app.router.add_get("/api/admin/config", admin_get_config)
    app.router.add_post("/api/admin/users", admin_save_user)
    app.router.add_delete("/api/admin/users/{username}", admin_delete_user)
    app.router.add_get("/api/admin/entities", admin_entities)
    app.router.add_get("/api/admin/security-log", api_security_log)
    app.router.add_get("/api/tools", api_tools)
    app.router.add_get("/api/admin/system", api_system)

    # tool plugins register their own routes
    load_tools(app)

    app.router.add_static("/static/", APP / "static")
    return app


def _ssl_context():
    """Build an SSL context from /ssl certs, or None (with a log) if unusable."""
    if os.environ.get("SSL", "false").lower() != "true":
        return None
    import ssl as ssl_mod
    cert = "/ssl/" + os.environ.get("CERTFILE", "fullchain.pem")
    key = "/ssl/" + os.environ.get("KEYFILE", "privkey.pem")
    if not (Path(cert).is_file() and Path(key).is_file()):
        log.error("SSL enabled but %s / %s not found — falling back to HTTP. "
                  "Put your certificate in the /ssl folder (e.g. via the "
                  "Let's Encrypt or Duck DNS add-on).", cert, key)
        return None
    ctx = ssl_mod.SSLContext(ssl_mod.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(cert, key)
    return ctx


async def main():
    bootstrap()
    app = build_app()
    runner = web.AppRunner(app)
    await runner.setup()

    ctx = _ssl_context()
    await web.TCPSite(runner, "0.0.0.0", PORT, ssl_context=ctx).start()
    log.info("Advance Tools %s listening on :%s (%s) — %d tool(s)",
             VERSION, PORT, "https" if ctx else "http", len(TOOLS))
    if ctx and os.environ.get("KEEP_HTTP", "false").lower() == "true":
        await web.TCPSite(runner, "0.0.0.0", PORT + 1).start()
        log.info("Extra HTTP listener on :%s", PORT + 1)
    await web.TCPSite(runner, "0.0.0.0", INGRESS_PORT).start()
    log.info("Ingress launcher on :%s (HA sidebar)", INGRESS_PORT)
    await HA.run()               # returns immediately in dev mode
    while True:                  # keep alive when HA loop not running
        await asyncio.sleep(3600)


if __name__ == "__main__":
    asyncio.run(main())
