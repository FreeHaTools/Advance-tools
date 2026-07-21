"""Family Board — Advance Tools plugin.

A family organizer with three sections:

* Shopping / to-do lists backed by real Home Assistant ``todo`` entities,
  so they stay in sync with the HA mobile app and voice assistants.
  New lists are created through the ``local_todo`` config flow; items are
  managed with the ``todo.*`` services and the ``todo/item/list`` WebSocket
  command.
* Chores with person rotation, due weekdays and streaks — stored locally
  in /data/family_board.json.
* Sticky notes — stored locally as well. Notes carry an author, an
  audience (everyone or specific panel users) and a reply thread, so they
  can be shown on end-user wall-tablet dashboards. A set of NON-admin
  ``/api/dash/family_board/*`` endpoints serves those dashboards: any
  logged-in panel user with access to the dashboard can read their notes,
  reply, and manage todo items allowed by the dashboard's entity allowlist.

A tiny background task ticks shortly after midnight so the "due today"
badges roll over; it never modifies stored data.
"""
import asyncio
import datetime
import json
import time
import uuid
from fnmatch import fnmatch
from pathlib import Path

import aiohttp
from aiohttp import web

X = None  # core context, injected by the loader
TOOL_DIR = Path(__file__).parent

CORE_API = "http://supervisor/core/api"

WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday",
            "saturday", "sunday")
ITEM_STATUSES = ("needs_action", "completed")
NOTE_COLORS = ("yellow", "pink", "blue", "green", "orange")
DONE_LOG_MAX = 100
REPLY_MAX_LEN = 300          # characters per reply
REPLIES_MAX = 50             # replies kept per note
AUDIENCE_USERS_MAX = 50      # usernames per note audience

_LOCK = asyncio.Lock()


# ---------------------------------------------------------------- storage

def _store_file():
    return X.DATA / "family_board.json"


def _load():
    data = {}
    f = _store_file()
    if f.exists():
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                data = {}
        except Exception:
            X.log.exception("family_board: could not read %s", f)
            data = {}
    data.setdefault("chores", [])
    data.setdefault("notes", [])
    data.setdefault("done_log", [])
    for n in data["notes"]:
        _migrate_note(n)
    return data


def _migrate_note(note):
    """Upgrade pre-2.8 notes in place: author/audience/replies fields."""
    if not isinstance(note.get("author"), str):
        note["author"] = ""
    aud = note.get("audience")
    if not (isinstance(aud, dict) and aud.get("type") in ("all", "users")):
        note["audience"] = {"type": "all"}
    elif aud.get("type") == "users":
        aud["users"] = [str(u) for u in (aud.get("users") or [])
                        if isinstance(u, str) and u.strip()]
    if not isinstance(note.get("replies"), list):
        note["replies"] = []


def _clean_audience(raw):
    """Normalize a client-supplied audience object."""
    if isinstance(raw, dict) and raw.get("type") == "users":
        users = []
        for u in (raw.get("users") or []):
            u = str(u).strip()[:60]
            if u and u not in users:
                users.append(u)
        if users:
            return {"type": "users", "users": users[:AUDIENCE_USERS_MAX]}
    return {"type": "all"}


def _note_visible(note, username):
    aud = note.get("audience") or {}
    if aud.get("type") == "users":
        return username in (aud.get("users") or [])
    return True


def _save(data):
    f = _store_file()
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2),
                   encoding="utf-8")
    tmp.replace(f)


# ---------------------------------------------------------------- HA REST

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


def _check_todo(entity_id):
    if not isinstance(entity_id, str) or not entity_id.startswith("todo."):
        raise web.HTTPBadRequest(text="entity_id must be a todo entity")


# ---------------------------------------------------------------- chores helpers

def _chore_view(ch):
    """Chore dict + computed fields (due_today, current_assignee, next_due)."""
    out = dict(ch)
    assignees = ch.get("assignees") or []
    turn = int(ch.get("turn") or 0)
    out["current_assignee"] = (assignees[turn % len(assignees)]
                               if assignees else "")
    today = datetime.date.today()
    wd_idx = today.weekday()
    days = [d for d in (ch.get("days") or []) if d in WEEKDAYS]
    due_day = (not days) or (WEEKDAYS[wd_idx] in days)
    last = ch.get("last_done")
    done_today = False
    if last:
        try:
            done_today = datetime.date.fromtimestamp(float(last)) == today
        except Exception:
            done_today = False
    out["done_today"] = done_today
    out["due_today"] = due_day and not done_today
    nxt = ""
    for off in range(1, 8):
        w = WEEKDAYS[(wd_idx + off) % 7]
        if not days or w in days:
            nxt = w
            break
    out["next_due"] = nxt
    return out


def _find(items, item_id):
    return next((it for it in items if it.get("id") == item_id), None)


# ---------------------------------------------------------------- pages

async def page_tool(request):
    if not X.is_admin(request):
        raise web.HTTPFound("/?d=__admin__")
    return web.FileResponse(TOOL_DIR / "static" / "index.html")


# ---------------------------------------------------------------- board

async def api_board(request):
    """Everything in one call: todo lists + items, chores, notes, activity."""
    X.require_admin(request)
    connected = X.HA.connected
    lists = []
    if connected:
        eids = sorted(eid for eid in X.HA.states if eid.startswith("todo."))

        async def fetch(eid):
            st = X.HA.states.get(eid) or {}
            attrs = st.get("attributes") or {}
            entry = {"entity_id": eid,
                     "name": attrs.get("friendly_name")
                             or eid.split(".", 1)[1].replace("_", " ").title(),
                     "items": [], "error": ""}
            try:
                res = await X.HA.ws_call({"type": "todo/item/list",
                                          "entity_id": eid})
                entry["items"] = (res or {}).get("items") or []
            except Exception as exc:
                entry["error"] = str(exc)
            return entry

        lists = list(await asyncio.gather(*(fetch(e) for e in eids)))
    async with _LOCK:
        data = _load()
    return web.json_response({
        "connected": connected,
        "today": WEEKDAYS[datetime.date.today().weekday()],
        "lists": lists,
        "chores": [_chore_view(c) for c in data["chores"]],
        "notes": data["notes"],
        "done_log": data["done_log"][-20:],
    })


# ---------------------------------------------------------------- todo lists

async def api_list_create(request):
    """Create a new list via the local_todo config flow."""
    X.require_admin(request)
    body = await request.json()
    name = str(body.get("name", "")).strip()
    if not name:
        return _err("a list name is required", 400)

    status, flow = await _core_rest(
        "POST", "/config/config_entries/flow",
        {"handler": "local_todo", "show_advanced_options": True})
    if status not in (200, 201) or not isinstance(flow, dict):
        msg = flow.get("message", "") if isinstance(flow, dict) else ""
        return _err("Could not start the Local To-do list wizard"
                    f" ({msg or f'HTTP {status}'}). Your Home Assistant is "
                    "probably too old — update HA Core to a version that "
                    "includes the 'Local to-do' integration.", 502)
    flow_id = flow.get("flow_id")

    status, res = await _core_rest(
        "POST", f"/config/config_entries/flow/{flow_id}",
        {"todo_list_name": name})
    if status not in (200, 201) or not isinstance(res, dict):
        await _core_rest("DELETE", f"/config/config_entries/flow/{flow_id}")
        msg = res.get("message", "") if isinstance(res, dict) else ""
        return _err(msg or f"HTTP {status}", 502)

    rtype = res.get("type")
    if rtype == "create_entry":
        return web.json_response({"ok": True, "title": res.get("title", name)})
    if rtype == "abort":
        return _err("Home Assistant refused to create the list: "
                    + str(res.get("reason", "aborted")), 502)
    # unexpected extra form step — abort so no half-finished flow lingers
    await _core_rest("DELETE", f"/config/config_entries/flow/{flow_id}")
    errors = res.get("errors") or {}
    detail = ", ".join(f"{k}: {v}" for k, v in errors.items()) or str(rtype)
    return _err(f"Could not create the list ({detail}).", 502)


# ---------------------------------------------------------------- todo items

async def api_item_add(request):
    X.require_admin(request)
    body = await request.json()
    eid = body.get("entity_id")
    _check_todo(eid)
    summary = str(body.get("summary", "")).strip()
    if not summary:
        return _err("item text is required", 400)
    try:
        await X.HA.call_service("todo", "add_item", {"item": summary},
                                target={"entity_id": eid})
    except Exception as exc:
        return _err(exc)
    return web.json_response({"ok": True})


async def api_item_status(request):
    X.require_admin(request)
    body = await request.json()
    eid = body.get("entity_id")
    _check_todo(eid)
    uid = str(body.get("uid", ""))
    status = str(body.get("status", ""))
    if not uid:
        return _err("uid is required", 400)
    if status not in ITEM_STATUSES:
        return _err("status must be needs_action or completed", 400)
    try:
        await X.HA.call_service("todo", "update_item",
                                {"item": uid, "status": status},
                                target={"entity_id": eid})
    except Exception as exc:
        return _err(exc)
    return web.json_response({"ok": True})


async def api_item_rename(request):
    X.require_admin(request)
    body = await request.json()
    eid = body.get("entity_id")
    _check_todo(eid)
    uid = str(body.get("uid", ""))
    name = str(body.get("name", "")).strip()
    if not uid:
        return _err("uid is required", 400)
    if not name:
        return _err("the new name cannot be empty", 400)
    try:
        await X.HA.call_service("todo", "update_item",
                                {"item": uid, "rename": name},
                                target={"entity_id": eid})
    except Exception as exc:
        return _err(exc)
    return web.json_response({"ok": True})


async def api_item_delete(request):
    X.require_admin(request)
    body = await request.json()
    eid = body.get("entity_id")
    _check_todo(eid)
    uid = str(body.get("uid", ""))
    if not uid:
        return _err("uid is required", 400)
    try:
        await X.HA.call_service("todo", "remove_item", {"item": uid},
                                target={"entity_id": eid})
    except Exception as exc:
        return _err(exc)
    return web.json_response({"ok": True})


async def api_clear_completed(request):
    X.require_admin(request)
    body = await request.json()
    eid = body.get("entity_id")
    _check_todo(eid)
    try:
        await X.HA.call_service("todo", "remove_completed_items", None,
                                target={"entity_id": eid})
    except Exception as exc:
        return _err(exc)
    return web.json_response({"ok": True})


# ---------------------------------------------------------------- chores

async def api_chore_save(request):
    """Create a chore, or update one when an id is supplied."""
    X.require_admin(request)
    body = await request.json()
    name = str(body.get("name", "")).strip()
    if not name:
        return _err("a chore name is required", 400)
    icon = str(body.get("icon") or "🧹").strip()[:8] or "🧹"
    assignees = [str(a).strip() for a in (body.get("assignees") or [])
                 if str(a).strip()][:20]
    days = [d for d in (body.get("days") or []) if d in WEEKDAYS]
    cid = str(body.get("id") or "").strip()

    async with _LOCK:
        data = _load()
        if cid:
            ch = _find(data["chores"], cid)
            if not ch:
                return _err("chore not found", 404)
            ch["name"] = name
            ch["icon"] = icon
            ch["assignees"] = assignees
            ch["days"] = days
            ch["turn"] = (int(ch.get("turn") or 0) % len(assignees)
                          if assignees else 0)
        else:
            ch = {"id": uuid.uuid4().hex[:12], "name": name, "icon": icon,
                  "assignees": assignees, "turn": 0, "days": days,
                  "last_done": None, "streak": 0}
            data["chores"].append(ch)
        _save(data)
    return web.json_response({"ok": True, "chore": _chore_view(ch)})


async def api_chore_done(request):
    X.require_admin(request)
    cid = request.match_info["chore_id"]
    try:
        body = await request.json()
    except Exception:
        body = {}
    async with _LOCK:
        data = _load()
        ch = _find(data["chores"], cid)
        if not ch:
            return _err("chore not found", 404)
        assignees = ch.get("assignees") or []
        turn = int(ch.get("turn") or 0)
        current = assignees[turn % len(assignees)] if assignees else ""
        by = str(body.get("by") or current or "someone").strip()[:60]
        view = _chore_view(ch)
        if view["due_today"]:          # done on a due day it wasn't done yet
            ch["streak"] = int(ch.get("streak") or 0) + 1
        ch["last_done"] = time.time()
        if assignees:
            ch["turn"] = (turn + 1) % len(assignees)
        data["done_log"].append({"ts": ch["last_done"],
                                 "chore": ch["name"], "by": by})
        data["done_log"] = data["done_log"][-DONE_LOG_MAX:]
        _save(data)
    return web.json_response({"ok": True, "chore": _chore_view(ch)})


async def api_chore_delete(request):
    X.require_admin(request)
    cid = request.match_info["chore_id"]
    async with _LOCK:
        data = _load()
        before = len(data["chores"])
        data["chores"] = [c for c in data["chores"] if c.get("id") != cid]
        if len(data["chores"]) == before:
            return _err("chore not found", 404)
        _save(data)
    return web.json_response({"ok": True})


# ---------------------------------------------------------------- notes

async def api_note_save(request):
    """Create a sticky note, or update one when an id is supplied."""
    admin = X.require_admin(request)
    body = await request.json()
    text = str(body.get("text", "")).strip()[:2000]
    color = body.get("color")
    nid = str(body.get("id") or "").strip()
    if color not in NOTE_COLORS:
        color = None

    async with _LOCK:
        data = _load()
        if nid:
            note = _find(data["notes"], nid)
            if not note:
                return _err("note not found", 404)
            if "text" in body:
                note["text"] = text
            if color:
                note["color"] = color
            if "audience" in body:
                note["audience"] = _clean_audience(body.get("audience"))
        else:
            if not text:
                return _err("the note is empty", 400)
            note = {"id": uuid.uuid4().hex[:12], "text": text,
                    "color": color
                             or NOTE_COLORS[len(data["notes"])
                                            % len(NOTE_COLORS)],
                    "created": time.time(),
                    "author": admin,
                    "audience": _clean_audience(body.get("audience")),
                    "replies": []}
            data["notes"].append(note)
        _save(data)
    return web.json_response({"ok": True, "note": note})


async def api_note_delete(request):
    X.require_admin(request)
    nid = request.match_info["note_id"]
    async with _LOCK:
        data = _load()
        before = len(data["notes"])
        data["notes"] = [n for n in data["notes"] if n.get("id") != nid]
        if len(data["notes"]) == before:
            return _err("note not found", 404)
        _save(data)
    return web.json_response({"ok": True})


# ---------------------------------------------------------------- users (admin)

async def api_users(request):
    """Panel usernames for the note audience picker — names and the admin
    flag only, never password hashes."""
    X.require_admin(request)
    users = [{"name": n, "is_admin": bool(u.get("is_admin"))}
             for n, u in sorted(X.STORE.data["users"].items())]
    return web.json_response({"users": users})


# ---------------------------------------------------------------- replies

def _validate_reply_text(raw):
    text = str(raw or "").strip()
    if not text:
        return None, _err("reply text is required", 400)
    if len(text) > REPLY_MAX_LEN:
        return None, _err(f"reply is too long (max {REPLY_MAX_LEN} "
                          "characters)", 400)
    return text, None


def _new_reply(user, text):
    return {"id": uuid.uuid4().hex[:12], "user": user, "text": text,
            "ts": time.time()}


async def api_reply_add(request):
    """Admin reply from the tool UI."""
    admin = X.require_admin(request)
    body = await request.json()
    note_id = str(body.get("note_id") or "")
    text, bad = _validate_reply_text(body.get("text"))
    if bad:
        return bad
    async with _LOCK:
        data = _load()
        note = _find(data["notes"], note_id)
        if not note:
            return _err("note not found", 404)
        if len(note["replies"]) >= REPLIES_MAX:
            return _err(f"reply limit reached ({REPLIES_MAX} per note)", 400)
        reply = _new_reply(admin, text)
        note["replies"].append(reply)
        _save(data)
    return web.json_response({"ok": True, "reply": reply})


async def api_reply_delete(request):
    """Admins may delete any reply."""
    X.require_admin(request)
    body = await request.json()
    note_id = str(body.get("note_id") or "")
    reply_id = str(body.get("reply_id") or "")
    async with _LOCK:
        data = _load()
        note = _find(data["notes"], note_id)
        if not note:
            return _err("note not found", 404)
        before = len(note["replies"])
        note["replies"] = [r for r in note["replies"]
                           if r.get("id") != reply_id]
        if len(note["replies"]) == before:
            return _err("reply not found", 404)
        _save(data)
    return web.json_response({"ok": True})


# ---------------------------------------------------------------- dashboard sessions
#
# End-user endpoints for wall tablets. NOT admin-gated: any logged-in panel
# user with access to the dashboard (?d=<slug> / "d" in the body) may call
# them. Todo entities are filtered through the dashboard's entity allowlist,
# exactly like Dashboard Maker does for service calls.

def make_matcher(dash):
    """Return f(entity_id)->bool for a dashboard's entity allowlist.
    Same semantics as dashboard_maker: allow_all wins, otherwise the id
    must match one of the wildcard patterns (fnmatch, e.g. ``todo.*``)."""
    if dash.get("allow_all"):
        return lambda eid: True
    patterns = [p.strip() for p in dash.get("entities", []) if p.strip()]
    return lambda eid: any(fnmatch(eid, p) for p in patterns)


def _dash_auth(request, slug):
    name = X.request_user(request)
    if not name:
        raise web.HTTPUnauthorized(text="not logged in")
    if not X.STORE.can_access(name, slug):
        raise web.HTTPForbidden(text="no access to this dashboard")
    return name


def _dash_config(slug):
    return X.STORE.data["dashboards"].get(slug) or {}


def _public_note(note):
    """Note as exposed to dashboard sessions."""
    return {"id": note["id"], "text": note.get("text", ""),
            "color": note.get("color", "yellow"),
            "created": note.get("created"),
            "author": note.get("author", ""),
            "audience": note.get("audience") or {"type": "all"},
            "replies": note.get("replies") or []}


async def api_dash_board(request):
    """Notes visible to the session user + todo lists allowed on the
    dashboard, in one call."""
    slug = request.query.get("d", "")
    name = _dash_auth(request, slug)
    matcher = make_matcher(_dash_config(slug))

    lists = []
    if X.HA.connected:
        eids = sorted(eid for eid in X.HA.states
                      if eid.startswith("todo.") and matcher(eid))

        async def fetch(eid):
            st = X.HA.states.get(eid) or {}
            attrs = st.get("attributes") or {}
            entry = {"entity_id": eid,
                     "name": attrs.get("friendly_name")
                             or eid.split(".", 1)[1].replace("_", " ").title(),
                     "items": []}
            try:
                res = await X.HA.ws_call({"type": "todo/item/list",
                                          "entity_id": eid})
                entry["items"] = [
                    {"uid": it.get("uid"), "summary": it.get("summary"),
                     "status": it.get("status")}
                    for it in ((res or {}).get("items") or [])]
            except Exception as exc:
                entry["error"] = str(exc)
            return entry

        lists = list(await asyncio.gather(*(fetch(e) for e in eids)))

    async with _LOCK:
        data = _load()
    notes = [_public_note(n) for n in data["notes"] if _note_visible(n, name)]
    return web.json_response({"user": name, "connected": X.HA.connected,
                              "notes": notes, "lists": lists})


async def api_dash_reply_add(request):
    """A dashboard user replies to a note they can see."""
    body = await request.json()
    slug = str(body.get("d") or "")
    name = _dash_auth(request, slug)
    note_id = str(body.get("note_id") or "")
    text, bad = _validate_reply_text(body.get("text"))
    if bad:
        return bad
    async with _LOCK:
        data = _load()
        note = _find(data["notes"], note_id)
        if not note or not _note_visible(note, name):
            return _err("note not found", 404)
        if len(note["replies"]) >= REPLIES_MAX:
            return _err(f"reply limit reached ({REPLIES_MAX} per note)", 400)
        reply = _new_reply(name, text)
        note["replies"].append(reply)
        _save(data)
    return web.json_response({"ok": True, "reply": reply})


async def api_dash_reply_delete(request):
    """A dashboard user may delete only their OWN reply."""
    body = await request.json()
    slug = str(body.get("d") or "")
    name = _dash_auth(request, slug)
    note_id = str(body.get("note_id") or "")
    reply_id = str(body.get("reply_id") or "")
    async with _LOCK:
        data = _load()
        note = _find(data["notes"], note_id)
        if not note or not _note_visible(note, name):
            return _err("note not found", 404)
        reply = _find(note["replies"], reply_id)
        if not reply:
            return _err("reply not found", 404)
        if reply.get("user") != name:
            raise web.HTTPForbidden(text="you can only delete your own reply")
        note["replies"] = [r for r in note["replies"]
                           if r.get("id") != reply_id]
        _save(data)
    return web.json_response({"ok": True})


async def api_dash_item(request):
    """Todo item actions from a dashboard, restricted to entities allowed
    by that dashboard's allowlist."""
    body = await request.json()
    slug = str(body.get("d") or "")
    _dash_auth(request, slug)
    eid = body.get("entity_id")
    _check_todo(eid)
    if eid not in X.HA.states or not make_matcher(_dash_config(slug))(eid):
        raise web.HTTPForbidden(text="entity not allowed for this dashboard")

    action = str(body.get("action") or "")
    try:
        if action == "add":
            summary = str(body.get("summary", "")).strip()
            if not summary:
                return _err("item text is required", 400)
            await X.HA.call_service("todo", "add_item",
                                    {"item": summary[:200]},
                                    target={"entity_id": eid})
        elif action == "toggle":
            uid = str(body.get("uid", ""))
            status = str(body.get("status", ""))
            if not uid:
                return _err("uid is required", 400)
            if status not in ITEM_STATUSES:
                return _err("status must be needs_action or completed", 400)
            await X.HA.call_service("todo", "update_item",
                                    {"item": uid, "status": status},
                                    target={"entity_id": eid})
        elif action == "remove_completed":
            await X.HA.call_service("todo", "remove_completed_items", None,
                                    target={"entity_id": eid})
        else:
            return _err("action must be add, toggle or remove_completed", 400)
    except web.HTTPException:
        raise
    except Exception as exc:
        return _err(exc)
    return web.json_response({"ok": True})


# ---------------------------------------------------------------- daily tick

async def _daily_loop():
    """Sleep until just past midnight, forever. Nothing destructive happens —
    due states are computed per request; this tick only marks the rollover
    in the log (and keeps the pattern ready for future scheduled work)."""
    while True:
        now = datetime.datetime.now()
        nxt = (now + datetime.timedelta(days=1)).replace(
            hour=0, minute=0, second=5, microsecond=0)
        try:
            await asyncio.sleep(max(1.0, (nxt - now).total_seconds()))
        except asyncio.CancelledError:
            return
        X.log.info("family_board: new day — chore due badges recomputed")


# ---------------------------------------------------------------- register

def register(app, ctx, manifest):
    global X
    X = ctx
    base = "/api/tools/family_board"
    app.router.add_get("/tools/family_board/", page_tool)

    app.router.add_get(f"{base}/board", api_board)
    app.router.add_post(f"{base}/list", api_list_create)

    app.router.add_post(f"{base}/item", api_item_add)
    app.router.add_post(f"{base}/item/status", api_item_status)
    app.router.add_post(f"{base}/item/rename", api_item_rename)
    app.router.add_post(f"{base}/item/delete", api_item_delete)
    app.router.add_delete(f"{base}/item", api_item_delete)
    app.router.add_post(f"{base}/clear_completed", api_clear_completed)

    app.router.add_post(f"{base}/chore", api_chore_save)
    app.router.add_post(f"{base}/chore/{{chore_id}}/done", api_chore_done)
    app.router.add_delete(f"{base}/chore/{{chore_id}}", api_chore_delete)

    app.router.add_post(f"{base}/note", api_note_save)
    app.router.add_delete(f"{base}/note/{{note_id}}", api_note_delete)

    app.router.add_get(f"{base}/users", api_users)
    app.router.add_post(f"{base}/reply", api_reply_add)
    app.router.add_delete(f"{base}/reply", api_reply_delete)

    # dashboard-session endpoints (any logged-in user with dashboard access)
    dash = "/api/dash/family_board"
    app.router.add_get(f"{dash}/board", api_dash_board)
    app.router.add_post(f"{dash}/reply", api_dash_reply_add)
    app.router.add_delete(f"{dash}/reply", api_dash_reply_delete)
    app.router.add_post(f"{dash}/item", api_dash_item)

    async def _start_daily(app):
        app["family_board_daily"] = asyncio.create_task(_daily_loop())

    async def _stop_daily(app):
        task = app.get("family_board_daily")
        if task:
            task.cancel()

    app.on_startup.append(_start_daily)
    app.on_cleanup.append(_stop_daily)
