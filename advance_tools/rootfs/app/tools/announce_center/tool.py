"""Announce & Intercom — Advance Tools plugin.

Turns the speakers in the house into an intercom: type (or tap) a
message, pick speakers, and it is spoken out loud via text-to-speech.
Also supports per-speaker + master volume control and optional push
notifications to phones through HA's notify services.

TTS engine detection is robust across HA versions:

* Modern installs expose engines as entities in the ``tts`` domain
  (e.g. ``tts.google_translate_en_com``) and are called through the
  ``tts.speak`` service with a ``media_player_entity_id`` list.
* Legacy platforms expose per-platform services such as
  ``tts.google_translate_say`` / ``tts.cloud_say`` and are called
  directly with an ``entity_id`` list.

Both kinds are surfaced to the frontend as selectable "engines" with
ids ``entity:<tts_entity>`` and ``legacy:<service>``.

Persistence: /data/announce_center.json (atomic write, asyncio.Lock)
holding defaults, quick messages and a ring buffer of announcement
history (last 100).

Dashboard intercom: non-admin, dashboard-session endpoints under
/api/dash/announce_center/* let wall tablets send text announcements
and real recorded voice clips. Clips are stored in /data/announce_clips
under unguessable 32-hex tokens and served without auth at
/api/tools/announce_center/clip/<token> so speakers can fetch them.
"""
import asyncio
import json
import os
import re
import secrets
import time
from pathlib import Path

from aiohttp import web

X = None                  # core context, injected by the loader
TOOL_DIR = Path(__file__).parent

CONF_FILE = None          # ctx.DATA / "announce_center.json", set in register()
LOCK = asyncio.Lock()

HISTORY_MAX = 100         # ring buffer size on disk
HISTORY_SHOW = 30         # how many entries /setup returns
QUICK_MAX = 30            # max quick messages
MSG_MAX = 1000            # max announcement length (characters)

DEFAULT_QUICK = [
    "Dinner is ready! 🍽",
    "Time for bed 🛏",
    "Leaving in 10 minutes 🚗",
]

SVC_RE = re.compile(r"^[a-z0-9_]{1,64}$")
ENGINE_ENTITY_RE = re.compile(r"^entity:tts\.[a-z0-9_]+$")
ENGINE_LEGACY_RE = re.compile(r"^legacy:[a-z0-9_]{1,60}_say$")

CLIPS_DIR = None          # ctx.DATA / "announce_clips", set in register()
CLIP_MAX_BYTES = 8 * 1024 * 1024   # max upload size for a voice clip
CLIP_KEEP = 20                     # keep only the newest N clips on disk
CLIP_TOKEN_RE = re.compile(r"^[0-9a-f]{32}$")
CLIP_CTYPES = {"audio/webm", "audio/ogg", "video/webm"}

AREA_CACHE_TTL = 60       # seconds; registry lookups are cached
_AREA_CACHE = {"ts": 0.0, "areas": [], "entity_area": {}}


def _err(exc_or_msg, status=502):
    return web.json_response({"error": str(exc_or_msg)}, status=status)

# ---------------------------------------------------------------- persistence


def _default_config():
    return {
        "default_players": [],
        "default_engine": None,
        "quick_messages": list(DEFAULT_QUICK),
        "history": [],
        "allow_dashboards": True,
    }


def _load():
    data = {}
    if CONF_FILE.exists():
        try:
            data = json.loads(CONF_FILE.read_text(encoding="utf-8"))
        except Exception:
            X.log.exception("announce_center: config unreadable — using defaults")
            data = {}
    cfg = _default_config()
    if isinstance(data, dict):
        for key in cfg:
            if key in data:
                cfg[key] = data[key]
    if not isinstance(cfg["default_players"], list):
        cfg["default_players"] = []
    if not isinstance(cfg["quick_messages"], list):
        cfg["quick_messages"] = list(DEFAULT_QUICK)
    if not isinstance(cfg["history"], list):
        cfg["history"] = []
    cfg["allow_dashboards"] = bool(cfg.get("allow_dashboards", True))
    return cfg


def _save(cfg):
    tmp = CONF_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(cfg, ensure_ascii=False, indent=2),
                   encoding="utf-8")
    tmp.replace(CONF_FILE)

# ---------------------------------------------------------------- HA lookups


def _players():
    """All media_player entities with live state + volume."""
    out = []
    for eid, st in sorted(X.HA.states.items()):
        if not eid.startswith("media_player."):
            continue
        attrs = st.get("attributes") or {}
        out.append({
            "entity_id": eid,
            "name": attrs.get("friendly_name") or eid,
            "state": st.get("state"),
            "volume_level": attrs.get("volume_level"),
            "supported_features": attrs.get("supported_features") or 0,
        })
    return out


def _entity_engines():
    """Modern TTS engines: entities in the tts domain."""
    out = []
    for eid, st in sorted(X.HA.states.items()):
        if not eid.startswith("tts."):
            continue
        attrs = st.get("attributes") or {}
        out.append({"id": f"entity:{eid}",
                    "name": attrs.get("friendly_name") or eid,
                    "kind": "entity"})
    return out


def _legacy_engines(services):
    """Legacy TTS platforms: tts.<platform>_say services."""
    out = []
    for svc in sorted((services or {}).get("tts") or {}):
        if svc.endswith("_say"):
            pretty = svc[:-len("_say")].replace("_", " ").title()
            out.append({"id": f"legacy:{svc}",
                        "name": f"{pretty} (legacy)",
                        "kind": "legacy"})
    return out


def _notify_services(services):
    """Available notify services, mobile apps first."""
    out = []
    for svc, info in ((services or {}).get("notify") or {}).items():
        if not SVC_RE.match(svc):
            continue
        name = (info or {}).get("name") or svc.replace("_", " ").title()
        out.append({"id": svc, "name": name,
                    "mobile": svc.startswith("mobile_app_")})
    out.sort(key=lambda s: (not s["mobile"], s["name"].lower()))
    return out

# ---------------------------------------------------------------- areas


async def _area_data():
    """(areas, entity_id -> area_id) built from the HA registries.

    entity.area_id wins; otherwise the entity inherits its device's area.
    Cached for AREA_CACHE_TTL seconds — registries rarely change.
    """
    now = time.time()
    if now - _AREA_CACHE["ts"] < AREA_CACHE_TTL:
        return _AREA_CACHE["areas"], _AREA_CACHE["entity_area"]

    areas_raw = await X.HA.ws_call({"type": "config/area_registry/list"})
    devices = await X.HA.ws_call({"type": "config/device_registry/list"})
    entities = await X.HA.ws_call({"type": "config/entity_registry/list"})

    dev_area = {d.get("id"): d.get("area_id") for d in (devices or [])}
    entity_area = {}
    for ent in (entities or []):
        eid = ent.get("entity_id")
        if not eid:
            continue
        entity_area[eid] = ent.get("area_id") or dev_area.get(ent.get("device_id"))

    areas = [{"id": a.get("area_id"), "name": a.get("name") or a.get("area_id")}
             for a in (areas_raw or []) if a.get("area_id")]
    areas.sort(key=lambda a: str(a["name"]).lower())

    _AREA_CACHE.update(ts=now, areas=areas, entity_area=entity_area)
    return areas, entity_area

# ---------------------------------------------------------------- helpers


def _public_base(request):
    """Base URL speakers can reach: DOMAIN env (same logic as the core's
    _public_domain) when configured, else scheme+host of this request."""
    domain = os.environ.get("DOMAIN", "").strip().rstrip("/")
    if domain and domain != "null":
        if "://" not in domain:
            domain = "https://" + domain
        return domain
    return f"{request.scheme}://{request.host}"


async def _pick_engine(cfg):
    """The tool's default TTS engine if still available, else the first
    available engine (modern entities first, then legacy services)."""
    services = {}
    try:
        services = await X.HA.ws_call({"type": "get_services"})
    except Exception:
        services = {}
    engines = [e["id"] for e in _entity_engines() + _legacy_engines(services)]
    default = cfg.get("default_engine")
    if default in engines:
        return default
    return engines[0] if engines else None


async def _log_history(message, players, ok, source):
    async with LOCK:
        cfg = _load()
        cfg["history"].append({"ts": int(time.time()), "message": message,
                               "players": players, "ok": ok,
                               "source": source})
        cfg["history"] = cfg["history"][-HISTORY_MAX:]
        _save(cfg)


def _dash_auth(request, slug):
    """Dashboard-session auth: any logged-in user with access to the
    dashboard slug may use the intercom endpoints (NOT admin-gated)."""
    name = X.request_user(request)
    if not name:
        raise web.HTTPUnauthorized(text="not logged in")
    if not X.STORE.can_access(name, slug):
        raise web.HTTPForbidden(text="no access to this dashboard")
    return name

# ---------------------------------------------------------------- pages


async def page_tool(request):
    if not X.is_admin(request):
        raise web.HTTPFound("/?d=__admin__")
    return web.FileResponse(TOOL_DIR / "static" / "index.html")

# ---------------------------------------------------------------- API: setup


async def api_setup(request):
    """Everything the page needs in one call."""
    X.require_admin(request)
    async with LOCK:
        cfg = _load()

    services = {}
    if X.HA.connected:
        try:
            services = await X.HA.ws_call({"type": "get_services"})
        except Exception:
            X.log.exception("announce_center: get_services failed")
            services = {}

    engines = _entity_engines() + _legacy_engines(services)
    return web.json_response({
        "connected": X.HA.connected,
        "players": _players(),
        "engines": engines,
        "notify_services": _notify_services(services),
        "config": {
            "default_players": cfg["default_players"],
            "default_engine": cfg["default_engine"],
            "quick_messages": cfg["quick_messages"],
            "allow_dashboards": cfg["allow_dashboards"],
        },
        "public_base": _public_base(request),
        "history": list(reversed(cfg["history"][-HISTORY_SHOW:])),
    })

# ---------------------------------------------------------------- API: announce


LANGUAGE_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{1,50}$")


async def _tts_batch(engine, players, message, language=None):
    """One TTS service call for a list of players. Raises on failure.

    ``language`` is passed straight to the TTS integration: a locale
    ("fa-IR", "en-US") or a full voice name ("fa-IR-FaridNeural") for
    engines like Edge TTS that accept voices in the language field.
    """
    if engine.startswith("entity:"):
        data = {"media_player_entity_id": players, "message": message,
                "cache": True}
        if language:
            data["language"] = language
        await X.HA.call_service("tts", "speak", data,
                                target={"entity_id": engine[len("entity:"):]})
    else:
        data = {"entity_id": players, "message": message}
        if language:
            data["language"] = language
        await X.HA.call_service("tts", engine[len("legacy:"):], data)


async def _run_tts(engine, players, message, language=None):
    """Announce to all players at once; on failure retry one-by-one so a
    single broken speaker doesn't hide which targets actually worked."""
    try:
        await _tts_batch(engine, players, message, language)
        return [{"target": p, "step": "tts", "ok": True} for p in players]
    except Exception as exc:
        if len(players) == 1:
            return [{"target": players[0], "step": "tts", "ok": False,
                     "error": str(exc)}]
    results = []
    for p in players:
        try:
            await _tts_batch(engine, [p], message, language)
            results.append({"target": p, "step": "tts", "ok": True})
        except Exception as exc:
            results.append({"target": p, "step": "tts", "ok": False,
                            "error": str(exc)})
    return results


async def api_announce(request):
    X.require_admin(request)
    body = await request.json()

    message = str(body.get("message", "")).strip()
    if not message:
        return _err("message is required", 400)
    if len(message) > MSG_MAX:
        return _err(f"message too long (max {MSG_MAX} characters)", 400)

    players = [p for p in (body.get("players") or [])
               if isinstance(p, str) and p.startswith("media_player.")]
    notify = [n for n in (body.get("also_notify") or [])
              if isinstance(n, str) and SVC_RE.match(n)]
    engine = str(body.get("engine") or "")
    language = str(body.get("language") or "").strip() or None
    if language and not LANGUAGE_RE.match(language):
        return _err("invalid language / voice", 400)

    if not players and not notify:
        return _err("pick at least one speaker or phone", 400)
    if players and not (ENGINE_ENTITY_RE.match(engine)
                        or ENGINE_LEGACY_RE.match(engine)):
        return _err("no valid TTS engine selected", 400)
    if not X.HA.connected:
        return _err("not connected to Home Assistant", 503)

    results = []

    # optional: set the volume on every speaker before announcing
    volume = body.get("volume", None)
    if volume is not None and players:
        try:
            vol = max(0.0, min(1.0, float(volume)))
        except (TypeError, ValueError):
            return _err("volume must be a number between 0 and 1", 400)
        for p in players:
            try:
                await X.HA.call_service("media_player", "volume_set",
                                        {"volume_level": vol},
                                        target={"entity_id": p})
            except Exception as exc:
                results.append({"target": p, "step": "volume", "ok": False,
                                "error": str(exc)})

    if players:
        results += await _run_tts(engine, players, message, language)

    for svc in notify:
        try:
            await X.HA.call_service("notify", svc,
                                    {"message": message,
                                     "title": "📢 Announcement"})
            results.append({"target": f"notify.{svc}", "step": "notify",
                            "ok": True})
        except Exception as exc:
            results.append({"target": f"notify.{svc}", "step": "notify",
                            "ok": False, "error": str(exc)})

    ok = bool(results) and all(r["ok"] for r in results)
    await _log_history(message, players, ok, "admin")
    return web.json_response({"ok": ok, "results": results})

# ---------------------------------------------------------------- API: config


async def api_config(request):
    """Save defaults and quick messages."""
    X.require_admin(request)
    body = await request.json()
    async with LOCK:
        cfg = _load()
        if "default_players" in body:
            cfg["default_players"] = [
                p for p in (body.get("default_players") or [])
                if isinstance(p, str) and p.startswith("media_player.")][:50]
        if "default_engine" in body:
            eng = body.get("default_engine")
            cfg["default_engine"] = (
                eng if isinstance(eng, str)
                and (ENGINE_ENTITY_RE.match(eng) or ENGINE_LEGACY_RE.match(eng))
                else None)
        if "quick_messages" in body:
            msgs = [str(m).strip()[:200]
                    for m in (body.get("quick_messages") or [])
                    if str(m).strip()]
            cfg["quick_messages"] = msgs[:QUICK_MAX]
        if "allow_dashboards" in body:
            cfg["allow_dashboards"] = bool(body.get("allow_dashboards"))
        _save(cfg)
        saved = {"default_players": cfg["default_players"],
                 "default_engine": cfg["default_engine"],
                 "quick_messages": cfg["quick_messages"],
                 "allow_dashboards": cfg["allow_dashboards"]}
    return web.json_response({"ok": True, "config": saved})

# ---------------------------------------------------------------- API: volume


async def api_volume(request):
    X.require_admin(request)
    body = await request.json()
    eid = str(body.get("entity_id", ""))
    if not eid.startswith("media_player."):
        return _err("entity_id must be a media_player entity", 400)
    try:
        vol = float(body.get("volume_level"))
    except (TypeError, ValueError):
        return _err("volume_level must be a number between 0 and 1", 400)
    vol = max(0.0, min(1.0, vol))
    if not X.HA.connected:
        return _err("not connected to Home Assistant", 503)
    try:
        await X.HA.call_service("media_player", "volume_set",
                                {"volume_level": vol},
                                target={"entity_id": eid})
    except Exception as exc:
        return _err(exc)
    return web.json_response({"ok": True, "volume_level": vol})

# ---------------------------------------------------------------- API: dashboard intercom


async def _dash_gate(request):
    """Common auth for the /api/dash endpoints: logged-in dashboard user
    with access to ?d=<slug> (or body \"d\"), plus the admin toggle."""
    slug = request.query.get("d", "")
    return await _dash_gate_slug(request, slug)


async def _dash_gate_slug(request, slug):
    slug = str(slug or "")
    if not X.SLUG_RE.match(slug):
        raise web.HTTPBadRequest(text="missing or invalid dashboard slug")
    name = _dash_auth(request, slug)
    async with LOCK:
        cfg = _load()
    if not cfg["allow_dashboards"]:
        raise web.HTTPForbidden(text="dashboard announcements are disabled")
    return name, cfg


async def api_dash_volume(request):
    """Volume control from a dashboard session (Intercom widget sliders)."""
    try:
        body = await request.json()
    except Exception:
        return _err("invalid JSON body", 400)
    await _dash_gate_slug(request, body.get("d", ""))
    eid = str(body.get("entity_id", ""))
    if not eid.startswith("media_player."):
        return _err("entity_id must be a media_player entity", 400)
    try:
        vol = float(body.get("volume_level"))
    except (TypeError, ValueError):
        return _err("volume_level must be a number between 0 and 1", 400)
    vol = max(0.0, min(1.0, vol))
    if not X.HA.connected:
        return _err("not connected to Home Assistant", 503)
    try:
        await X.HA.call_service("media_player", "volume_set",
                                {"volume_level": vol},
                                target={"entity_id": eid})
    except Exception as exc:
        return _err(exc)
    return web.json_response({"ok": True})


async def api_dash_targets(request):
    """Speakers grouped by area + quick messages, for the Intercom widget."""
    _name, cfg = await _dash_gate(request)

    players = _players()
    areas, entity_area = [], {}
    if X.HA.connected and players:
        try:
            areas, entity_area = await _area_data()
        except Exception:
            X.log.exception("announce_center: registry lookup failed")

    by_area = {}
    other = []
    for p in players:
        slim = {"entity_id": p["entity_id"], "name": p["name"],
                "state": p["state"],
                "volume_level": p["volume_level"],
                "supported_features": p["supported_features"]}
        aid = entity_area.get(p["entity_id"])
        if aid:
            by_area.setdefault(aid, []).append(slim)
        else:
            other.append(slim)

    default_engine = (await _pick_engine(cfg)) if X.HA.connected else None

    return web.json_response({
        "areas": [{"id": a["id"], "name": a["name"],
                   "players": by_area[a["id"]]}
                  for a in areas if a["id"] in by_area],
        "other_players": other,
        "quick_messages": cfg["quick_messages"],
        "tts_available": bool(default_engine),
        "engine_id": default_engine,
        "voice_available": bool(players),
    })


async def api_dash_announce(request):
    """Text/quick-message TTS from a dashboard session."""
    try:
        body = await request.json()
    except Exception:
        return _err("invalid JSON body", 400)
    name, cfg = await _dash_gate_slug(request, body.get("d", ""))

    message = str(body.get("message", "")).strip()
    if not message:
        return _err("message is required", 400)
    if len(message) > MSG_MAX:
        return _err(f"message too long (max {MSG_MAX} characters)", 400)
    players = [p for p in (body.get("players") or [])
               if isinstance(p, str) and p.startswith("media_player.")]
    if not players:
        return _err("pick at least one speaker", 400)
    if not X.HA.connected:
        return _err("not connected to Home Assistant", 503)

    engine = await _pick_engine(cfg)
    if not engine:
        return _err("no TTS engine available — ask your admin to add one", 503)

    language = str(body.get("language") or "").strip() or None
    if language and not LANGUAGE_RE.match(language):
        return _err("invalid language / voice", 400)

    results = await _run_tts(engine, players, message, language)
    ok = bool(results) and all(r["ok"] for r in results)
    await _log_history(message, players, ok, name)
    return web.json_response({"ok": ok, "results": results})


def _prune_clips():
    """Keep only the newest CLIP_KEEP clips on disk."""
    try:
        clips = sorted(CLIPS_DIR.glob("*.webm"),
                       key=lambda p: p.stat().st_mtime, reverse=True)
        for old in clips[CLIP_KEEP:]:
            try:
                old.unlink()
            except OSError:
                pass
    except Exception:
        X.log.exception("announce_center: clip pruning failed")


async def api_dash_voice(request):
    """Real voice intercom: raw recorded audio in the body, played on the
    selected speakers via media_player.play_media + a public clip URL."""
    name, _cfg = await _dash_gate(request)

    players = [p.strip() for p in request.query.get("players", "").split(",")
               if p.strip().startswith("media_player.")]
    if not players:
        return _err("pick at least one speaker", 400)
    if request.content_type not in CLIP_CTYPES:
        return _err("unsupported audio type (use audio/webm or audio/ogg)", 415)
    if request.content_length and request.content_length > CLIP_MAX_BYTES:
        return _err("clip too large (max 8 MB)", 413)
    body = await request.read()
    if len(body) > CLIP_MAX_BYTES:
        return _err("clip too large (max 8 MB)", 413)
    if len(body) < 100:
        return _err("empty recording", 400)
    if not X.HA.connected:
        return _err("not connected to Home Assistant", 503)

    CLIPS_DIR.mkdir(parents=True, exist_ok=True)
    token = secrets.token_hex(16)                      # 32 hex chars
    (CLIPS_DIR / f"{token}.webm").write_bytes(body)
    _prune_clips()

    url = _public_base(request) + f"/api/tools/announce_center/clip/{token}"
    results = []
    for p in players:
        data = {"media_content_id": url, "media_content_type": "music",
                "announce": True}
        try:
            await X.HA.call_service("media_player", "play_media", data,
                                    target={"entity_id": p})
            results.append({"target": p, "step": "voice", "ok": True})
        except Exception:
            # some players reject the announce flag — retry without it
            try:
                await X.HA.call_service(
                    "media_player", "play_media",
                    {"media_content_id": url, "media_content_type": "music"},
                    target={"entity_id": p})
                results.append({"target": p, "step": "voice", "ok": True,
                                "announce": False})
            except Exception as exc:
                results.append({"target": p, "step": "voice", "ok": False,
                                "error": str(exc)})

    ok = bool(results) and all(r["ok"] for r in results)
    await _log_history("🎙 Voice message", players, ok, name)
    return web.json_response({"ok": ok, "results": results, "clip": url})


async def api_clip(request):
    """Serve a stored voice clip. NO auth — the 32-hex token is unguessable
    and speakers (Sonos, Cast, …) fetch the URL without cookies."""
    token = request.match_info.get("token", "")
    if not CLIP_TOKEN_RE.match(token):
        raise web.HTTPNotFound(text="unknown clip")
    path = CLIPS_DIR / f"{token}.webm"          # strict token => no traversal
    if not path.is_file():
        raise web.HTTPNotFound(text="unknown or expired clip")
    return web.Response(body=path.read_bytes(),
                        content_type="audio/webm",
                        headers={"Cache-Control": "no-store"})

# ---------------------------------------------------------------- register


def register(app, ctx, manifest):
    global X, CONF_FILE, CLIPS_DIR
    X = ctx
    CONF_FILE = ctx.DATA / "announce_center.json"
    CLIPS_DIR = ctx.DATA / "announce_clips"
    base = "/api/tools/announce_center"
    dash = "/api/dash/announce_center"

    app.router.add_get("/tools/announce_center/", page_tool)
    app.router.add_get(f"{base}/setup", api_setup)
    app.router.add_post(f"{base}/announce", api_announce)
    app.router.add_post(f"{base}/config", api_config)
    app.router.add_post(f"{base}/volume", api_volume)
    # public (token-guarded) clip download for the speakers themselves
    app.router.add_get(f"{base}/clip/{{token}}", api_clip)
    # dashboard-session intercom endpoints (NOT admin-gated)
    app.router.add_get(f"{dash}/targets", api_dash_targets)
    app.router.add_post(f"{dash}/volume", api_dash_volume)
    app.router.add_post(f"{dash}/announce", api_dash_announce)
    app.router.add_post(f"{dash}/voice", api_dash_voice)
