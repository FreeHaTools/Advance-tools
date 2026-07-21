"""Starter Templates — Advance Tools plugin.

Turns an empty canvas into a finished wall-tablet dashboard. The user picks a
template, we auto-match its "slots" against the entities their Home Assistant
actually has, they review/adjust the matches, and Apply writes a real Dashboard
Maker dashboard (store entry + <DATA>/dashboards/<slug>/design.json).

Nothing is ever overwritten unless the caller explicitly asks for it, and the
new dashboard is a completely normal Dashboard Maker dashboard afterwards — it
can be edited in the visual designer like any hand-built one.


================================================================================
TEMPLATE FILE FORMAT  (templates/<id>.json)
================================================================================

Adding a template is a pure drop-in: put a .json file in templates/ and it shows
up in the gallery on the next request. No Python change is needed.

{
  "id":          "family_home",          // optional, defaults to the filename
  "name":        "Family Home",
  "icon":        "🏠",
  "description": "One-line pitch shown on the gallery card.",
  "tags":        ["lights", "climate"],  // free-form chips on the card
  "summary":     ["Lights for 4 rooms", "..."],   // the "what you get" bullets

  "canvas": { "w": 1280, "h": 800, "fit": "fit" },   // fit | fill | stretch
  "theme":  { "accent": "#4f8cff", "bg": "#0f1420", "card": "#1a2233",
              "text": "#e8edf7", "cols": 4, "radius": 14 },

  "slots": [
    {
      "key":          "living_room_light",   // referenced by widgets
      "label":        "Living room light",   // shown in the review screen
      "hint":         "The main light...",   // helper text under the label
      "domain":       "light",               // REQUIRED — hard filter
      "device_class": "temperature",         // optional, strongly preferred
      "keywords":     ["living", "lounge"],  // matched against id + name
      "exclude":      ["garden"],            // heavy penalty if present
      "area_hint":    "living room",         // preferred HA area name
      "required":     true                   // Apply is blocked until mapped
    }
  ],

  "widgets": [
    // Exactly the Dashboard Maker widget shape (see static/designer.js
    // addWidget + static/widgets.js). "id" is assigned automatically.
    { "type": "box",  "text": "LIGHTS", "x": 40, "y": 100, "w": 620, "h": 254 },
    { "type": "light", "skin": "rgb-expand-pro", "x": 64, "y": 140,
      "w": 280, "h": 82, "entity": "{{slot:living_room_light}}" },

    // A widget may also declare extra dependencies. It is dropped unless every
    // listed slot resolved — handy for group boxes and labels that carry no
    // entity of their own.
    { "type": "box", "text": "FAMILY LIST", "x": 40, "y": 378, "w": 340,
      "h": 382, "requires": ["family_list"] }
  ]
}

Placeholders
------------
Any string value anywhere inside a widget may be exactly "{{slot:<key>}}".
It is replaced with the mapped entity_id. A widget containing an unresolved
placeholder (an optional slot the user left empty) is silently dropped instead
of being emitted broken — that is why optional slots are safe.


================================================================================
HTTP API  (base: /api/tools/starter_templates)
================================================================================

GET  /                 tool page (admin-gated)
GET  /list             all templates (metadata only)
POST /preview          {template_id}          -> template + scored slots
POST /apply            {template_id, slug, name, mapping, overwrite?}
GET  /entities         ?domain=light          -> picker source (extension)
"""
import json
import re

from aiohttp import web

X = None            # core context (set by register)
TOOL_DIR = None     # tools/starter_templates
TPL_DIR = None      # tools/starter_templates/templates
DASH_DIR = None     # <DATA>/dashboards  — same directory Dashboard Maker uses

PLACEHOLDER_RE = re.compile(r"^\{\{slot:([A-Za-z0-9_]+)\}\}$")

# Score a candidate must reach before we pre-select it for the user.
AUTO_PICK_SCORE = 45.0
# A lone candidate is accepted much more easily (there is nothing to confuse it
# with), and so is a candidate that leaves the runner-up far behind.
LONE_MIN_SCORE = 15.0
CLEAR_WIN_SCORE = 25.0
CLEAR_WIN_MARGIN = 20.0

MAX_MATCHES = 8

DEFAULT_CANVAS = {"w": 1280, "h": 800, "fit": "fit"}
DEFAULT_THEME = {"accent": "#4f8cff", "bg": "#0f1420", "card": "#1a2233",
                 "text": "#e8edf7", "cols": 4, "radius": 14}

_CACHE = {"stamp": 0.0, "items": []}     # templates, reloaded when files change


# ---------------------------------------------------------------- helpers

def _err(msg, status=400):
    return web.json_response({"error": str(msg)}, status=status)


def _dir_stamp():
    """Cheap change detector: newest mtime + file count of templates/."""
    newest, count = 0.0, 0
    if TPL_DIR and TPL_DIR.is_dir():
        for p in TPL_DIR.glob("*.json"):
            try:
                newest = max(newest, p.stat().st_mtime)
            except OSError:
                continue
            count += 1
    return newest + count


def _clean_slot(raw, index):
    """Normalise one slot definition, or return None if unusable."""
    if not isinstance(raw, dict):
        return None
    key = str(raw.get("key") or "").strip()
    domain = str(raw.get("domain") or "").strip()
    if not key or not domain:
        return None
    return {
        "key": key,
        "label": str(raw.get("label") or key.replace("_", " ").title()),
        "hint": str(raw.get("hint") or ""),
        "domain": domain,
        "device_class": (str(raw["device_class"])
                         if raw.get("device_class") else None),
        "keywords": [str(k).lower() for k in (raw.get("keywords") or [])
                     if str(k).strip()],
        "exclude": [str(k).lower() for k in (raw.get("exclude") or [])
                    if str(k).strip()],
        "area_hint": str(raw.get("area_hint") or ""),
        "required": bool(raw.get("required")),
        "order": index,
    }


def _load_templates():
    """All valid templates, newest-file-wins cache. Never raises."""
    stamp = _dir_stamp()
    if _CACHE["items"] and abs(_CACHE["stamp"] - stamp) < 1e-9:
        return _CACHE["items"]

    items = []
    if TPL_DIR and TPL_DIR.is_dir():
        for path in sorted(TPL_DIR.glob("*.json")):
            try:
                raw = json.loads(path.read_text(encoding="utf-8"))
            except Exception as exc:
                X.log.warning("Starter Templates: bad template %s — %s",
                              path.name, exc)
                continue
            if not isinstance(raw, dict):
                continue
            widgets = raw.get("widgets")
            if not isinstance(widgets, list) or not widgets:
                X.log.warning("Starter Templates: %s has no widgets — skipped",
                              path.name)
                continue

            slots, seen = [], set()
            for i, s in enumerate(raw.get("slots") or []):
                slot = _clean_slot(s, i)
                if slot and slot["key"] not in seen:
                    seen.add(slot["key"])
                    slots.append(slot)

            canvas = dict(DEFAULT_CANVAS)
            canvas.update(raw.get("canvas") or {})
            theme = dict(DEFAULT_THEME)
            theme.update(raw.get("theme") or {})

            items.append({
                "id": str(raw.get("id") or path.stem),
                "name": str(raw.get("name") or path.stem),
                "icon": str(raw.get("icon") or "📦"),
                "description": str(raw.get("description") or ""),
                "tags": [str(t) for t in (raw.get("tags") or [])],
                "summary": [str(t) for t in (raw.get("summary") or [])],
                "canvas": canvas,
                "theme": theme,
                "slots": slots,
                "widgets": widgets,
            })

    items.sort(key=lambda t: t["name"].lower())
    _CACHE["stamp"] = stamp
    _CACHE["items"] = items
    return items


def _template(tid):
    for t in _load_templates():
        if t["id"] == tid:
            return t
    return None


def _meta(tpl):
    """The public (gallery) view of a template."""
    return {
        "id": tpl["id"],
        "name": tpl["name"],
        "icon": tpl["icon"],
        "description": tpl["description"],
        "tags": tpl["tags"],
        "summary": tpl["summary"],
        "canvas": {"w": tpl["canvas"].get("w", 1280),
                   "h": tpl["canvas"].get("h", 800)},
        "widget_count": len(tpl["widgets"]),
        "slot_count": len(tpl["slots"]),
    }


# ---------------------------------------------------------------- areas

async def _area_map():
    """entity_id -> area name, via the same registries Entity Doctor reads.

    Returns {} when Home Assistant is unreachable; area scoring is then simply
    skipped rather than breaking the whole match.
    """
    try:
        entities = await X.HA.ws_call({"type": "config/entity_registry/list"})
        devices = await X.HA.ws_call({"type": "config/device_registry/list"})
        areas = await X.HA.ws_call({"type": "config/area_registry/list"})
    except Exception as exc:
        X.log.debug("Starter Templates: registries unavailable (%s)", exc)
        return {}

    names = {a.get("area_id"): (a.get("name") or "")
             for a in (areas or []) if a.get("area_id")}
    dev_area = {d.get("id"): d.get("area_id")
                for d in (devices or []) if d.get("id")}

    out = {}
    for ent in entities or []:
        eid = ent.get("entity_id")
        if not eid:
            continue
        area_id = ent.get("area_id") or dev_area.get(ent.get("device_id"))
        name = names.get(area_id)
        if name:
            out[eid] = name
    return out


# ---------------------------------------------------------------- matching

def _friendly(eid, st):
    return str(((st or {}).get("attributes") or {}).get("friendly_name")
               or eid)


def _score(slot, eid, st, area):
    """How well does this entity fit the slot? None = wrong domain."""
    if eid.split(".", 1)[0] != slot["domain"]:
        return None

    attrs = (st or {}).get("attributes") or {}
    score = 20.0

    want_dc = slot["device_class"]
    has_dc = attrs.get("device_class")
    if want_dc:
        if has_dc == want_dc:
            score += 32.0
        elif has_dc:
            score -= 26.0          # explicitly a different kind of thing
        else:
            score -= 8.0           # unknown — possible, but unproven

    object_id = eid.split(".", 1)[1].lower() if "." in eid else eid.lower()
    name = _friendly(eid, st).lower()

    kws = slot["keywords"]
    if kws:
        hits_id = sum(1 for k in kws if k in object_id)
        hits_name = sum(1 for k in kws if k in name)
        score += min(hits_id, 2) * 17.0
        score += min(hits_name, 2) * 11.0
        if not hits_id and not hits_name:
            score -= 10.0

    for bad in slot["exclude"]:
        if bad in object_id or bad in name:
            score -= 40.0
            break

    hint = slot["area_hint"].lower()
    if hint and area:
        a = area.lower()
        if a == hint:
            score += 26.0
        elif hint in a or a in hint:
            score += 16.0

    # A dead entity must never win, however well its name reads.
    state = str((st or {}).get("state") or "")
    if state in ("unavailable", "unknown", ""):
        score -= 70.0
    if attrs.get("restored") is True:
        score -= 70.0

    if attrs.get("friendly_name"):
        score += 2.0
    return score


def _candidates(slot, states, areas):
    out = []
    for eid, st in states.items():
        score = _score(slot, eid, st, areas.get(eid))
        if score is None:
            continue
        out.append({
            "entity_id": eid,
            "name": _friendly(eid, st),
            "area": areas.get(eid) or "",
            "state": str((st or {}).get("state") or ""),
            "score": round(score, 1),
        })
    out.sort(key=lambda c: (-c["score"], c["entity_id"]))
    return out


def _auto_pick(cands, taken):
    """Pre-choose the best candidate when we are confident enough."""
    pool = [c for c in cands if c["entity_id"] not in taken]
    if not pool:
        return None
    best = pool[0]
    # A single healthy candidate is almost certainly the right one: asking
    # someone to "choose" their only thermostat is pointless. This check comes
    # first on purpose — a lone candidate with no keyword or area hits still
    # scores low, and the old ordering rejected it before it was ever
    # considered. Dead entities score negative (see the unavailable penalty)
    # and are still refused here.
    if len(pool) == 1:
        return best["entity_id"] if best["score"] > 0 else None
    if best["score"] < LONE_MIN_SCORE:
        return None
    if best["score"] >= AUTO_PICK_SCORE:
        return best["entity_id"]
    runner_up = pool[1]["score"]
    if (best["score"] >= CLEAR_WIN_SCORE
            and best["score"] - runner_up >= CLEAR_WIN_MARGIN):
        return best["entity_id"]
    return None


async def _build_slots(tpl):
    states = dict(X.HA.states or {})
    areas = await _area_map()

    slots, taken = [], set()
    for slot in tpl["slots"]:
        cands = _candidates(slot, states, areas)
        chosen = _auto_pick(cands, taken)
        if chosen:
            taken.add(chosen)
        slots.append({
            "key": slot["key"],
            "label": slot["label"],
            "hint": slot["hint"],
            "domain": slot["domain"],
            "device_class": slot["device_class"],
            "required": slot["required"],
            "matches": cands[:MAX_MATCHES],
            "chosen": chosen,
        })
    return slots


# ---------------------------------------------------------------- rendering

def _resolve_value(value, mapping):
    """Return (resolved, ok). ok=False when a placeholder has no mapping."""
    if not isinstance(value, str):
        return value, True
    m = PLACEHOLDER_RE.match(value.strip())
    if not m:
        return value, True
    eid = mapping.get(m.group(1))
    if not eid:
        return None, False
    return eid, True


def _render_widget(raw, mapping, index):
    """One template widget -> a real widget dict, or None if it must be dropped."""
    if not isinstance(raw, dict) or not raw.get("type"):
        return None

    for key in raw.get("requires") or []:
        if not mapping.get(str(key)):
            return None

    out = {}
    for key, value in raw.items():
        if key in ("requires", "id"):
            continue
        if isinstance(value, list):
            items = []
            for item in value:
                resolved, ok = _resolve_value(item, mapping)
                if not ok:
                    return None
                items.append(resolved)
            out[key] = items
        else:
            resolved, ok = _resolve_value(value, mapping)
            if not ok:
                return None
            out[key] = resolved

    out["id"] = "w%d" % index
    return out


def _render_design(tpl, title, mapping):
    widgets, index = [], 0
    for raw in tpl["widgets"]:
        index += 1
        w = _render_widget(raw, mapping, index)
        if w is not None:
            widgets.append(w)
    return {
        "title": title,
        "theme": dict(tpl["theme"]),
        "canvas": dict(tpl["canvas"]),
        "widgets": widgets,
    }


# ---------------------------------------------------------------- pages

async def page_tool(request):
    if not X.is_admin(request):
        raise web.HTTPFound("/?d=__admin__")
    return web.FileResponse(TOOL_DIR / "static" / "index.html")


# ---------------------------------------------------------------- API

async def api_list(request):
    X.require_admin(request)
    return web.json_response({"templates": [_meta(t) for t in _load_templates()]})


async def api_entities(request):
    """Picker source: every entity, optionally filtered to one domain."""
    X.require_admin(request)
    domain = request.query.get("domain", "").strip()
    areas = await _area_map()
    out = []
    for eid, st in (X.HA.states or {}).items():
        if domain and eid.split(".", 1)[0] != domain:
            continue
        out.append({
            "entity_id": eid,
            "name": _friendly(eid, st),
            "area": areas.get(eid) or "",
            "state": str((st or {}).get("state") or ""),
        })
    out.sort(key=lambda e: (e["entity_id"]))
    return web.json_response({"entities": out})


async def api_preview(request):
    X.require_admin(request)
    try:
        body = await request.json()
    except Exception:
        return _err("invalid JSON body")

    tpl = _template(str(body.get("template_id") or ""))
    if not tpl:
        return _err("unknown template", 404)

    slots = await _build_slots(tpl)
    missing = [s["label"] for s in slots if s["required"] and not s["chosen"]]
    return web.json_response({
        "template": _meta(tpl),
        "slots": slots,
        "ready": not missing,
        "missing": missing,
    })


async def api_apply(request):
    X.require_admin(request)
    try:
        body = await request.json()
    except Exception:
        return _err("invalid JSON body")

    tpl = _template(str(body.get("template_id") or ""))
    if not tpl:
        return _err("unknown template", 404)

    slug = str(body.get("slug") or "").strip().lower()
    if not X.SLUG_RE.match(slug):
        return _err("slug must be a-z, 0-9, _ (max 40 chars)")

    name = str(body.get("name") or "").strip() or tpl["name"]

    raw_mapping = body.get("mapping")
    if not isinstance(raw_mapping, dict):
        return _err("mapping must be an object")

    known = {s["key"]: s for s in tpl["slots"]}
    mapping = {}
    for key, eid in raw_mapping.items():
        key = str(key)
        if key not in known or not eid:
            continue
        eid = str(eid).strip()
        if not eid:
            continue
        if eid.split(".", 1)[0] != known[key]["domain"]:
            return _err("%s must be a %s entity, got %s"
                        % (known[key]["label"], known[key]["domain"], eid))
        mapping[key] = eid

    unmapped = [s["label"] for s in tpl["slots"]
                if s["required"] and not mapping.get(s["key"])]
    if unmapped:
        return _err("still missing: " + ", ".join(unmapped))

    exists = slug in X.STORE.data["dashboards"]
    if exists and not body.get("overwrite"):
        return _err("a dashboard named '%s' already exists" % slug, 409)

    design = _render_design(tpl, name, mapping)
    if not design["widgets"]:
        return _err("nothing to build — no widget survived the mapping")

    entities = sorted({w["entity"] for w in design["widgets"]
                       if isinstance(w.get("entity"), str) and "." in w["entity"]})
    # Anything else a widget points at (helper entities on multi-entity skins).
    for w in design["widgets"]:
        for key, value in w.items():
            if (key != "entity" and key.endswith("Entity")
                    and isinstance(value, str) and "." in value):
                if value not in entities:
                    entities.append(value)
    entities = sorted(set(entities))

    async with X.STORE.lock:
        dash = X.STORE.data["dashboards"].get(slug, {})
        dash["name"] = name
        dash["entities"] = entities
        dash["allow_all"] = False
        dash["mode"] = "design"
        X.STORE.data["dashboards"][slug] = dash
        X.STORE.save()

    ddir = DASH_DIR / slug
    ddir.mkdir(parents=True, exist_ok=True)
    (ddir / "design.json").write_text(
        json.dumps(design, ensure_ascii=False, indent=2), encoding="utf-8")

    X.log.info("Starter Templates: built '%s' from %s (%d widgets)",
               slug, tpl["id"], len(design["widgets"]))
    return web.json_response({
        "ok": True,
        "slug": slug,
        "url": "/d/%s/" % slug,
        "widgets": len(design["widgets"]),
        "entities": len(entities),
        "replaced": bool(exists),
    })


# ---------------------------------------------------------------- register

def register(app, ctx, manifest):
    global X, TOOL_DIR, TPL_DIR, DASH_DIR
    X = ctx
    TOOL_DIR = ctx.APP / "tools" / "starter_templates"
    TPL_DIR = TOOL_DIR / "templates"
    DASH_DIR = ctx.DATA / "dashboards"
    DASH_DIR.mkdir(parents=True, exist_ok=True)

    base = "/api/tools/starter_templates"
    app.router.add_get("/tools/starter_templates/", page_tool)
    app.router.add_get(f"{base}/list", api_list)
    app.router.add_get(f"{base}/entities", api_entities)
    app.router.add_post(f"{base}/preview", api_preview)
    app.router.add_post(f"{base}/apply", api_apply)
