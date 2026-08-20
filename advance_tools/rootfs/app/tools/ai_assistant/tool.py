"""AI Assistant — talk to Home Assistant in plain language.

A pluggable LLM (Anthropic Claude, OpenAI, or a local Ollama /
OpenAI-compatible server) is given three function-calling tools:

  * list_entities  — search the entity catalog (name, area, domain, state)
  * get_state      — full state + attributes of one entity
  * call_service   — perform an action (lights, covers, climate, …)

The agent loop keeps calling the model until it stops asking for tools,
then returns the final text.  Actions on *sensitive* domains (locks,
doors, alarm) can be set to run freely, require a confirmation, require
a PIN, or be blocked entirely — pending actions are parked server-side
and only executed once the user confirms (web UI button or Telegram
inline keyboard, plus the PIN when one is configured).

Front doors:
  * the web chat UI (with push-to-talk and a wake-word listener)
  * a Telegram bot (long polling, text + voice messages; voice notes are
    transcribed with OpenAI Whisper when an OpenAI key is available)

Nothing here talks to the outside world except the configured AI
provider and api.telegram.org.
"""

import asyncio
import json
import re
import secrets
import time
from pathlib import Path

import aiohttp
from aiohttp import web

X = None                      # tool context, set in register()
TOOL_DIR = Path(__file__).parent

TG_API = "https://api.telegram.org/bot{token}/{method}"

PROVIDERS = ("anthropic", "openai", "ollama")
DEFAULT_MODELS = {
    "anthropic": "claude-sonnet-4-5",
    "openai": "gpt-4o-mini",
    "ollama": "llama3.1",
}
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
OPENAI_URL = "https://api.openai.com/v1/chat/completions"
OPENAI_STT_URL = "https://api.openai.com/v1/audio/transcriptions"

MAX_TOOL_ROUNDS = 6           # LLM ↔ tool ping-pong limit per request
MAX_TURNS = 12                # conversation messages kept per session
SESSION_TTL = 900             # idle chat sessions dropped after 15 min
PENDING_TTL = 180             # unconfirmed sensitive actions expire (s)
CATALOG_LIMIT = 90            # max entities returned by one list_entities
LLM_TIMEOUT = aiohttp.ClientTimeout(total=90)

SAFETY_MODES = ("allow", "confirm", "pin", "block")
DEFAULT_SENSITIVE = ["lock", "alarm_control_panel", "cover"]

# Domains hidden from the model entirely — nothing useful to control and
# they leak internals (persistent notifications, zones, device trackers
# are fine to *read*, so they stay).
SKIP_DOMAINS = {"persistent_notification", "tts", "stt", "conversation",
                "update", "image", "event"}

DEFAULT_SETTINGS = {
    "provider": "anthropic",
    "anthropic_key": "",
    "openai_key": "",
    "ollama_url": "http://homeassistant.local:11434",
    "custom_key": "",   # optional — for hosted OpenAI-compatible APIs (Groq, Gemini, …)
    "model": "",                 # empty → provider default
    "assistant_name": "Nova",    # also the wake word ("hey nova")
    "wake_aliases": "",          # extra wake spellings, comma-separated
                                 # (e.g. Persian script the recognizer emits)
    "ack_text": "",              # spoken reply to the wake word ("Yes?")
    "language": "auto",          # STT hint for the browser mic
    "safety": {
        "mode": "confirm",       # allow | confirm | pin | block
        "pin": "",               # hashed, never returned to clients
        "sensitive_domains": list(DEFAULT_SENSITIVE),
    },
    "telegram": {
        "token": "",
        "polling": True,
        "allow_chats": [],
    },
}

_LOCK = asyncio.Lock()
_STATE = {"settings": {}}
_RUNTIME = {
    "sessions": {},        # sid -> {"messages": [...], "ts": unix}
    "pending": {},         # action id -> {"calls": [...], "ts", "origin"}
    "tasks": [],
    "bot_offset": 0,
    "bot_status": {"running": False, "username": "", "error": ""},
    "tg_awaiting_pin": {},  # chat_id -> action id
}


# ---------------------------------------------------------------- storage

def _store_file():
    return X.DATA / "ai_assistant.json"


def _load():
    data = {}
    f = _store_file()
    if f.exists():
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            X.log.exception("ai_assistant: could not read %s", f)
    settings = json.loads(json.dumps(DEFAULT_SETTINGS))
    saved = data.get("settings") or {}
    for key, value in saved.items():
        if key in ("safety", "telegram") and isinstance(value, dict):
            settings[key].update(value)
        else:
            settings[key] = value
    _STATE["settings"] = settings


def _save():
    f = _store_file()
    tmp = f.with_suffix(".tmp")
    tmp.write_text(json.dumps({"settings": _STATE["settings"]},
                              ensure_ascii=False, indent=2),
                   encoding="utf-8")
    tmp.replace(f)


def _err(message, status=400):
    return web.json_response({"error": str(message)}, status=status)


def _require_user(request):
    """Any signed-in user — dashboard widgets are not admin-only."""
    user = X.request_user(request)
    if not user:
        raise web.HTTPUnauthorized(
            text='{"error": "sign in first"}', content_type="application/json")
    return user


# ---------------------------------------------------------------- catalog

def _area_maps():
    """entity_id -> area name, using the registries the poller keeps warm."""
    return getattr(X.HA, "_ai_area_cache", None) or {}


async def _refresh_area_cache():
    try:
        areas = await X.HA.ws_call({"type": "config/area_registry/list"})
        devices = await X.HA.ws_call({"type": "config/device_registry/list"})
        entities = await X.HA.ws_call({"type": "config/entity_registry/list"})
    except Exception:
        return
    area_name = {a["area_id"]: a.get("name") or a["area_id"]
                 for a in (areas or [])}
    dev_area = {d["id"]: d.get("area_id") for d in (devices or [])}
    ent_area = {}
    for reg in entities or []:
        aid = reg.get("area_id") or dev_area.get(reg.get("device_id"))
        if aid and aid in area_name:
            ent_area[reg["entity_id"]] = area_name[aid]
    X.HA._ai_area_cache = ent_area
    X.HA._ai_area_names = sorted(set(area_name.values()))


KEEP_ATTRS = ("brightness", "color_temp_kelvin", "rgb_color", "color_mode",
              "current_temperature", "temperature", "hvac_action", "percentage",
              "current_position", "media_title", "volume_level", "preset_mode",
              "unit_of_measurement", "device_class", "battery_level")


def _slim(eid, st, areas, full=False):
    attrs = st.get("attributes") or {}
    item = {
        "entity_id": eid,
        "name": attrs.get("friendly_name") or eid,
        "state": st.get("state"),
    }
    area = areas.get(eid)
    if area:
        item["area"] = area
    if full:
        item["attributes"] = {k: v for k, v in attrs.items()
                              if not k.startswith("supported_")}
    else:
        extra = {k: attrs[k] for k in KEEP_ATTRS if attrs.get(k) is not None}
        if extra:
            item["attr"] = extra
    return item


def _list_entities(query="", domain="", area=""):
    areas = _area_maps()
    query = (query or "").strip().lower()
    domain = (domain or "").strip().lower()
    area = (area or "").strip().lower()
    out = []
    for eid, st in X.HA.states.items():
        dom = eid.split(".")[0]
        if dom in SKIP_DOMAINS:
            continue
        if domain and dom != domain:
            continue
        ent_area = (areas.get(eid) or "").lower()
        if area and area not in ent_area:
            continue
        if query:
            name = ((st.get("attributes") or {}).get("friendly_name")
                    or "").lower()
            if query not in eid.lower() and query not in name \
                    and query not in ent_area:
                continue
        out.append(_slim(eid, st, areas))
        if len(out) >= CATALOG_LIMIT:
            break
    return {"count": len(out), "entities": out,
            "truncated": len(out) >= CATALOG_LIMIT}


# ---------------------------------------------------------------- safety

def _sensitive_domains():
    return [d.strip().lower() for d in
            (_STATE["settings"]["safety"].get("sensitive_domains") or [])
            if d.strip()]


def _is_sensitive(domain, service, data):
    sens = _sensitive_domains()
    if domain in sens:
        return True
    targets = []
    for key in ("entity_id",):
        value = (data or {}).get(key)
        if isinstance(value, str):
            targets.append(value)
        elif isinstance(value, list):
            targets.extend(str(v) for v in value)
    return any(t.split(".")[0] in sens for t in targets)


def _describe_call(call):
    data = {k: v for k, v in (call.get("data") or {}).items()
            if k != "entity_id"}
    target = (call.get("data") or {}).get("entity_id") or "?"
    if isinstance(target, list):
        target = ", ".join(target)
    text = f"{call['domain']}.{call['service']} → {target}"
    if data:
        text += f" {json.dumps(data, ensure_ascii=False)}"
    return text


async def _execute_calls(calls):
    results = []
    for call in calls:
        data = dict(call.get("data") or {})
        try:
            await X.HA.call_service(call["domain"], call["service"], data)
            results.append({"ok": True, "call": _describe_call(call)})
        except Exception as exc:
            results.append({"ok": False, "call": _describe_call(call),
                            "error": str(exc)})
    return results


def _park_pending(calls, origin):
    now = time.time()
    for aid in [a for a, p in _RUNTIME["pending"].items()
                if now - p["ts"] > PENDING_TTL]:
        _RUNTIME["pending"].pop(aid, None)
    aid = secrets.token_urlsafe(8)
    _RUNTIME["pending"][aid] = {"calls": calls, "ts": now, "origin": origin}
    return aid


def _pin_ok(pin):
    stored = _STATE["settings"]["safety"].get("pin") or ""
    if not stored:
        return True
    try:
        return X.verify_password(str(pin or ""), stored)
    except Exception:
        return False


# ---------------------------------------------------------------- LLM tools

def _tool_specs():
    return [
        {
            "name": "list_entities",
            "description": (
                "Search the smart-home entity catalog. Filter by free-text "
                "query (matches id, friendly name or area), by domain "
                "(light, switch, lock, cover, climate, sensor, "
                "media_player, …) and/or by area name. Returns compact "
                "entries with current state. Call this before acting when "
                "you are not sure which entity the user means."),
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string"},
                    "domain": {"type": "string"},
                    "area": {"type": "string"},
                },
            },
        },
        {
            "name": "get_state",
            "description": ("Full state and attributes of one entity, "
                            "by exact entity_id."),
            "parameters": {
                "type": "object",
                "properties": {"entity_id": {"type": "string"}},
                "required": ["entity_id"],
            },
        },
        {
            "name": "call_service",
            "description": (
                "Perform an action by calling a Home Assistant service. "
                "Examples: light.turn_on with "
                "{entity_id, brightness_pct, color_name or rgb_color}, "
                "light.turn_off, switch.toggle, cover.open_cover, "
                "lock.lock / lock.unlock, climate.set_temperature with "
                "{entity_id, temperature}, media_player.volume_set, "
                "scene.turn_on, script.turn_on. Put entity_id (string or "
                "list) inside data. Sensitive actions may return "
                "CONFIRMATION_REQUIRED — tell the user to confirm, do not "
                "retry."),
            "parameters": {
                "type": "object",
                "properties": {
                    "domain": {"type": "string"},
                    "service": {"type": "string"},
                    "data": {"type": "object"},
                },
                "required": ["domain", "service"],
            },
        },
    ]


async def _run_tool(name, args, origin, collector):
    """Execute one LLM tool call; returns a JSON-serialisable result."""
    args = args or {}
    if name == "list_entities":
        return _list_entities(args.get("query", ""), args.get("domain", ""),
                              args.get("area", ""))
    if name == "get_state":
        eid = str(args.get("entity_id") or "")
        st = X.HA.states.get(eid)
        if not st:
            return {"error": f"unknown entity_id {eid!r} — use list_entities"}
        return _slim(eid, st, _area_maps(), full=True)
    if name == "call_service":
        domain = str(args.get("domain") or "").lower()
        service = str(args.get("service") or "").lower()
        data = args.get("data") or {}
        if not re.fullmatch(r"[a-z0-9_]+", domain) or \
                not re.fullmatch(r"[a-z0-9_]+", service):
            return {"error": "invalid domain/service"}
        call = {"domain": domain, "service": service, "data": data}
        mode = _STATE["settings"]["safety"].get("mode", "confirm")
        if _is_sensitive(domain, service, data):
            if mode == "block":
                return {"error": "This action touches a protected domain "
                                 "and is blocked in AI Assistant settings."}
            if mode in ("confirm", "pin"):
                aid = _park_pending([call], origin)
                collector["pending"] = {
                    "id": aid,
                    "needs_pin": mode == "pin",
                    "summary": _describe_call(call),
                }
                return {"result": "CONFIRMATION_REQUIRED",
                        "detail": "Ask the user to press Confirm"
                                  + (" and enter the PIN" if mode == "pin"
                                     else "") + ". Do not call again."}
        results = await _execute_calls([call])
        collector["actions"].extend(results)
        return {"results": results}
    return {"error": f"unknown tool {name!r}"}


def _system_prompt():
    s = _STATE["settings"]
    name = s.get("assistant_name") or "Nova"
    area_names = getattr(X.HA, "_ai_area_names", None) or []
    domains = {}
    for eid in X.HA.states:
        d = eid.split(".")[0]
        if d not in SKIP_DOMAINS:
            domains[d] = domains.get(d, 0) + 1
    dom_line = ", ".join(f"{d}({c})" for d, c in
                         sorted(domains.items(), key=lambda kv: -kv[1])[:14])
    return (
        f"You are {name}, the voice of this Home Assistant house. "
        "You control real devices through the provided tools.\n"
        f"Areas: {', '.join(area_names) or 'unknown'}.\n"
        f"Entity domains: {dom_line}.\n"
        "Rules:\n"
        "- Use list_entities to find the right entity before acting; never "
        "invent entity ids.\n"
        "- 'all lights' → list_entities(domain='light'), then one "
        "light.turn_off with the list of entity_ids.\n"
        "- Brightness: light.turn_on with brightness_pct (0-100). Colours: "
        "color_name or rgb_color.\n"
        "- After acting, answer with ONE short sentence describing what "
        "happened. No markdown tables, no emoji spam — replies may be "
        "spoken aloud.\n"
        "- If a tool returns CONFIRMATION_REQUIRED, tell the user to "
        "confirm and stop.\n"
        "- Answer in the language the user used (Persian → Persian, "
        "English → English).\n"
        "- If something is ambiguous, ask a short clarifying question "
        "instead of guessing."
    )


# ---------------------------------------------------------------- providers

def _provider_conf():
    s = _STATE["settings"]
    provider = s.get("provider") or "anthropic"
    if provider not in PROVIDERS:
        provider = "anthropic"
    model = (s.get("model") or "").strip() or DEFAULT_MODELS[provider]
    return provider, model


async def _llm_anthropic(model, messages, collector, origin):
    key = _STATE["settings"].get("anthropic_key") or ""
    if not key:
        raise RuntimeError("No Anthropic API key set — open Settings.")
    tools = [{"name": t["name"], "description": t["description"],
              "input_schema": t["parameters"]} for t in _tool_specs()]
    convo = list(messages)
    async with aiohttp.ClientSession(timeout=LLM_TIMEOUT) as http:
        for _ in range(MAX_TOOL_ROUNDS):
            payload = {"model": model, "max_tokens": 1024,
                       "system": _system_prompt(),
                       "messages": convo, "tools": tools}
            async with http.post(
                    ANTHROPIC_URL, json=payload,
                    headers={"x-api-key": key,
                             "anthropic-version": "2023-06-01"}) as resp:
                body = await resp.json(content_type=None)
                if not isinstance(body, dict):
                    raise RuntimeError(
                        f"Anthropic API: unexpected response "
                        f"(HTTP {resp.status}): {str(body)[:200]}")
                if resp.status != 200:
                    err = body.get("error")
                    msg = (err.get("message") if isinstance(err, dict)
                           else None) or str(body)
                    raise RuntimeError(f"Anthropic API: {msg}")
            content = body.get("content") or []
            convo.append({"role": "assistant", "content": content})
            if body.get("stop_reason") != "tool_use":
                text = " ".join(b.get("text", "") for b in content
                                if b.get("type") == "text").strip()
                return text or "(no reply)", convo
            tool_results = []
            for block in content:
                if block.get("type") != "tool_use":
                    continue
                result = await _run_tool(block.get("name"),
                                         block.get("input"), origin,
                                         collector)
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.get("id"),
                    "content": json.dumps(result, ensure_ascii=False),
                })
            convo.append({"role": "user", "content": tool_results})
    return "I ran out of steps — please try a simpler request.", convo


def _openai_url(base_url):
    """Chat-completions URL for an OpenAI-compatible server.

    Accepts the base URLs people actually paste:
      http://host:11434                     -> …/v1/chat/completions
      https://api.groq.com/openai           -> …/v1/chat/completions
      https://openrouter.ai/api/v1          -> …/chat/completions
      https://generativelanguage.googleapis.com/v1beta/openai
                                            -> …/chat/completions
      a full …/chat/completions URL         -> used verbatim
    """
    if not base_url:
        return OPENAI_URL
    base = base_url.rstrip("/")
    if base.endswith("/chat/completions"):
        return base
    if base.endswith("/v1") or base.endswith("/v1beta/openai"):
        return base + "/chat/completions"
    return base + "/v1/chat/completions"


async def _llm_openai_compatible(model, messages, collector, origin,
                                 base_url=None, key=None):
    url = _openai_url(base_url)
    headers = {}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    tools = [{"type": "function",
              "function": {"name": t["name"],
                           "description": t["description"],
                           "parameters": t["parameters"]}}
             for t in _tool_specs()]
    convo = [{"role": "system", "content": _system_prompt()}] + list(messages)
    async with aiohttp.ClientSession(timeout=LLM_TIMEOUT) as http:
        for _ in range(MAX_TOOL_ROUNDS):
            payload = {"model": model, "messages": convo, "tools": tools}
            async with http.post(url, json=payload, headers=headers) as resp:
                body = await resp.json(content_type=None)
                # Gemini's OpenAI-compat endpoint wraps errors in a list.
                if isinstance(body, list):
                    body = body[0] if body and isinstance(body[0], dict) else {}
                if not isinstance(body, dict):
                    raise RuntimeError(
                        f"AI provider: unexpected response "
                        f"(HTTP {resp.status}): {str(body)[:200]}")
                if resp.status != 200:
                    err = body.get("error")
                    if isinstance(err, dict):
                        msg = err.get("message") or str(err)
                    else:
                        msg = str(err or body)
                    raise RuntimeError(f"AI provider (HTTP {resp.status}): "
                                       f"{msg}")
            choice = (body.get("choices") or [{}])[0]
            message = choice.get("message") or {}
            convo.append(message)
            calls = message.get("tool_calls") or []
            if not calls:
                return (message.get("content") or "(no reply)").strip(), convo
            for tc in calls:
                fn = tc.get("function") or {}
                try:
                    args = json.loads(fn.get("arguments") or "{}")
                except Exception:
                    args = {}
                result = await _run_tool(fn.get("name"), args, origin,
                                         collector)
                convo.append({"role": "tool",
                              "tool_call_id": tc.get("id"),
                              "content": json.dumps(result,
                                                    ensure_ascii=False)})
    return "I ran out of steps — please try a simpler request.", convo


async def _agent(messages, origin):
    """Run one agent request. Returns (reply_text, collector)."""
    collector = {"actions": [], "pending": None}
    provider, model = _provider_conf()
    s = _STATE["settings"]
    if provider == "anthropic":
        text, _ = await _llm_anthropic(model, messages, collector, origin)
    elif provider == "openai":
        if not s.get("openai_key"):
            raise RuntimeError("No OpenAI API key set — open Settings.")
        text, _ = await _llm_openai_compatible(
            model, messages, collector, origin, key=s.get("openai_key"))
    else:  # ollama / any OpenAI-compatible local server
        text, _ = await _llm_openai_compatible(
            model, messages, collector, origin,
            base_url=s.get("ollama_url") or "http://localhost:11434",
            key=s.get("custom_key") or None)
    return text, collector


# ---------------------------------------------------------------- sessions

def _session(sid):
    now = time.time()
    for key in [k for k, v in _RUNTIME["sessions"].items()
                if now - v["ts"] > SESSION_TTL]:
        _RUNTIME["sessions"].pop(key, None)
    sess = _RUNTIME["sessions"].setdefault(sid, {"messages": [], "ts": now})
    sess["ts"] = now
    return sess


async def _converse(sid, user_text, origin):
    sess = _session(sid)
    sess["messages"].append({"role": "user", "content": user_text})
    sess["messages"] = sess["messages"][-MAX_TURNS:]
    async with _LOCK:
        text, collector = await _agent(list(sess["messages"]), origin)
    sess["messages"].append({"role": "assistant", "content": text})
    return text, collector


# ---------------------------------------------------------------- telegram

async def _tg_call(method, payload, token=None):
    token = token or _STATE["settings"]["telegram"].get("token") or ""
    if not token:
        return False, "no token"
    url = TG_API.format(token=token, method=method)
    try:
        timeout = aiohttp.ClientTimeout(total=45)
        async with aiohttp.ClientSession(timeout=timeout) as http:
            async with http.post(url, json=payload) as resp:
                body = await resp.json(content_type=None)
    except Exception as exc:
        return False, str(exc)
    if not body.get("ok"):
        return False, body.get("description") or str(body)
    return True, body.get("result")


async def _tg_download(file_id):
    token = _STATE["settings"]["telegram"].get("token") or ""
    ok, info = await _tg_call("getFile", {"file_id": file_id})
    if not ok:
        return None
    path = (info or {}).get("file_path")
    if not path:
        return None
    url = f"https://api.telegram.org/file/bot{token}/{path}"
    try:
        timeout = aiohttp.ClientTimeout(total=60)
        async with aiohttp.ClientSession(timeout=timeout) as http:
            async with http.get(url) as resp:
                if resp.status != 200:
                    return None
                return await resp.read()
    except Exception:
        return None


async def _transcribe(audio, filename="voice.ogg"):
    """OpenAI Whisper transcription — used for Telegram voice notes."""
    key = _STATE["settings"].get("openai_key") or ""
    if not key:
        return None, ("Voice notes need an OpenAI API key for "
                      "transcription — add one in AI Assistant → Settings "
                      "(any provider can stay the chat brain).")
    form = aiohttp.FormData()
    form.add_field("model", "whisper-1")
    form.add_field("file", audio, filename=filename,
                   content_type="audio/ogg")
    try:
        timeout = aiohttp.ClientTimeout(total=90)
        async with aiohttp.ClientSession(timeout=timeout) as http:
            async with http.post(
                    OPENAI_STT_URL, data=form,
                    headers={"Authorization": f"Bearer {key}"}) as resp:
                body = await resp.json(content_type=None)
                if isinstance(body, list):
                    body = body[0] if body and isinstance(body[0], dict) else {}
                if not isinstance(body, dict):
                    return None, (f"Transcription failed "
                                  f"(HTTP {resp.status}): {str(body)[:200]}")
                if resp.status != 200:
                    err = body.get("error")
                    msg = (err.get("message") if isinstance(err, dict)
                           else None) or str(body)
                    return None, f"Transcription failed: {msg}"
                return (body.get("text") or "").strip(), None
    except Exception as exc:
        return None, f"Transcription failed: {exc}"


def _tg_allowed(chat_id):
    allowed = [str(c) for c in
               (_STATE["settings"]["telegram"].get("allow_chats") or [])]
    return str(chat_id) in allowed


async def _tg_reply(chat_id, text, pending=None):
    payload = {"chat_id": chat_id, "text": text[:4000]}
    if pending:
        payload["reply_markup"] = {"inline_keyboard": [[
            {"text": "✅ Confirm", "callback_data": f"ok:{pending['id']}"},
            {"text": "❌ Cancel", "callback_data": f"no:{pending['id']}"},
        ]]}
    await _tg_call("sendMessage", payload)


async def _tg_handle_text(chat_id, text):
    text = text.strip()
    if text in ("/start", "/help"):
        name = _STATE["settings"].get("assistant_name") or "Nova"
        await _tg_reply(chat_id,
                        f"🤖 I'm {name}. Tell me what to do — e.g. "
                        "'turn off all lights', 'set the bedroom to 21°', "
                        "'is the front door locked?'. /reset clears our "
                        "conversation.")
        return
    if text == "/reset":
        _RUNTIME["sessions"].pop(f"tg:{chat_id}", None)
        await _tg_reply(chat_id, "🧹 Conversation cleared.")
        return

    waiting = _RUNTIME["tg_awaiting_pin"].get(chat_id)
    if waiting:
        _RUNTIME["tg_awaiting_pin"].pop(chat_id, None)
        pending = _RUNTIME["pending"].pop(waiting, None)
        if not pending:
            await _tg_reply(chat_id, "That action expired — ask me again.")
            return
        if not _pin_ok(text):
            await _tg_reply(chat_id, "❌ Wrong PIN. Action cancelled.")
            return
        results = await _execute_calls(pending["calls"])
        good = all(r["ok"] for r in results)
        await _tg_reply(chat_id, "✅ Done." if good else
                        "⚠️ " + "; ".join(r.get("error", "") for r in results
                                          if not r["ok"]))
        return

    try:
        reply, collector = await _converse(f"tg:{chat_id}", text, "telegram")
    except Exception as exc:
        await _tg_reply(chat_id, f"⚠️ {exc}")
        return
    await _tg_reply(chat_id, reply, pending=collector.get("pending"))


async def _tg_handle_callback(query):
    data = str(query.get("data") or "")
    chat_id = ((query.get("message") or {}).get("chat") or {}).get("id")
    answer = ""
    if chat_id is not None and _tg_allowed(chat_id) and ":" in data:
        verb, aid = data.split(":", 1)
        pending = _RUNTIME["pending"].get(aid)
        if not pending:
            answer = "Expired."
        elif verb == "no":
            _RUNTIME["pending"].pop(aid, None)
            answer = "Cancelled."
        elif verb == "ok":
            needs_pin = (_STATE["settings"]["safety"].get("mode") == "pin"
                         and _STATE["settings"]["safety"].get("pin"))
            if needs_pin:
                _RUNTIME["tg_awaiting_pin"][chat_id] = aid
                answer = "Send the PIN as a message."
                await _tg_reply(chat_id, "🔐 Send the PIN to run this "
                                         "action.")
            else:
                _RUNTIME["pending"].pop(aid, None)
                results = await _execute_calls(pending["calls"])
                good = all(r["ok"] for r in results)
                answer = "Done." if good else "Failed."
                await _tg_reply(chat_id, "✅ Done." if good else
                                "⚠️ Something failed — check the logs.")
    await _tg_call("answerCallbackQuery",
                   {"callback_query_id": query.get("id"),
                    "text": answer[:200]})


async def _tg_loop():
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
                X.log.info("ai_assistant: Telegram bot @%s connected",
                           status["username"])
            ok, result = await _tg_call("getUpdates", {
                "offset": _RUNTIME["bot_offset"],
                "timeout": 30,
                "allowed_updates": ["message", "callback_query"],
            })
            if not ok:
                if "Conflict" in str(result):
                    result = (str(result) + " — another poller is using this "
                              "bot token (Notify Hub?). Use a separate bot "
                              "for AI Assistant.")
                status.update({"error": str(result)})
                await asyncio.sleep(10)
                continue
            status["error"] = ""
            for update in result or []:
                _RUNTIME["bot_offset"] = int(update.get("update_id", 0)) + 1
                if "callback_query" in update:
                    await _tg_handle_callback(update["callback_query"])
                    continue
                message = update.get("message") or {}
                chat_id = (message.get("chat") or {}).get("id")
                if chat_id is None:
                    continue
                if not _tg_allowed(chat_id):
                    await _tg_reply(chat_id,
                                    "👋 This bot is not linked yet.\n"
                                    f"Your chat ID is {chat_id}.\n"
                                    "Add it in Advance Tools → AI Assistant "
                                    "→ Settings to allow commands.")
                    continue
                if message.get("voice") or message.get("audio"):
                    media = message.get("voice") or message.get("audio")
                    audio = await _tg_download(media.get("file_id"))
                    if not audio:
                        await _tg_reply(chat_id, "⚠️ Could not fetch that "
                                                 "voice note.")
                        continue
                    text, err = await _transcribe(audio)
                    if err:
                        await _tg_reply(chat_id, f"⚠️ {err}")
                        continue
                    if text:
                        await _tg_reply(chat_id, f"🎙 “{text}”")
                        await _tg_handle_text(chat_id, text)
                    continue
                text = str(message.get("text") or "")
                if text:
                    await _tg_handle_text(chat_id, text)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            status.update({"error": str(exc)})
            X.log.exception("ai_assistant: Telegram polling failed")
            await asyncio.sleep(10)


async def _area_cache_loop():
    while True:
        try:
            if X.HA.connected:
                await _refresh_area_cache()
        except asyncio.CancelledError:
            raise
        except Exception:
            X.log.exception("ai_assistant: area cache refresh failed")
        await asyncio.sleep(300)


# ---------------------------------------------------------------- pages/API

async def page_tool(request):
    if not X.is_admin(request):
        raise web.HTTPFound("/?d=__admin__")
    return web.FileResponse(TOOL_DIR / "static" / "index.html")


def _public_settings():
    s = json.loads(json.dumps(_STATE["settings"]))
    s["anthropic_key_set"] = bool(s.pop("anthropic_key", ""))
    s["openai_key_set"] = bool(s.pop("openai_key", ""))
    s["custom_key_set"] = bool(s.pop("custom_key", ""))
    s["telegram"]["token_set"] = bool(s["telegram"].pop("token", ""))
    s["safety"]["pin_set"] = bool(s["safety"].pop("pin", ""))
    return s


async def api_data(request):
    X.require_admin(request)
    return web.json_response({
        "settings": _public_settings(),
        "bot": dict(_RUNTIME["bot_status"]),
        "connected": X.HA.connected,
        "entities": len(X.HA.states),
        "areas": getattr(X.HA, "_ai_area_names", None) or [],
        "defaults": DEFAULT_MODELS,
    })


async def api_settings(request):
    X.require_admin(request)
    try:
        body = await request.json()
    except Exception:
        return _err("invalid JSON")
    s = _STATE["settings"]

    if "provider" in body:
        if body["provider"] not in PROVIDERS:
            return _err("unknown provider")
        s["provider"] = body["provider"]
    for key in ("model", "assistant_name", "language", "ollama_url",
                "wake_aliases", "ack_text"):
        if key in body:
            s[key] = str(body[key] or "").strip()
    if not s.get("assistant_name"):
        s["assistant_name"] = "Nova"
    for key in ("anthropic_key", "openai_key", "custom_key"):
        if key in body:                      # "" clears, non-empty replaces
            s[key] = str(body[key] or "").strip()

    safety = body.get("safety") or {}
    if "mode" in safety:
        if safety["mode"] not in SAFETY_MODES:
            return _err("unknown safety mode")
        s["safety"]["mode"] = safety["mode"]
    if "sensitive_domains" in safety:
        s["safety"]["sensitive_domains"] = [
            str(d).strip().lower() for d in
            (safety["sensitive_domains"] or []) if str(d).strip()][:20]
    if "pin" in safety:
        pin = str(safety["pin"] or "").strip()
        s["safety"]["pin"] = X.hash_password(pin) if pin else ""

    tg = body.get("telegram") or {}
    if "token" in tg:
        s["telegram"]["token"] = str(tg["token"] or "").strip()
        _RUNTIME["bot_status"].update({"username": "", "error": ""})
        _RUNTIME["bot_offset"] = 0
    if "polling" in tg:
        s["telegram"]["polling"] = bool(tg["polling"])
    if "allow_chats" in tg:
        s["telegram"]["allow_chats"] = [
            str(c).strip() for c in (tg["allow_chats"] or [])
            if str(c).strip()][:20]

    _save()
    X.log_security("ai_assistant_settings", X.request_user(request) or "",
                   X.client_ip(request))
    return web.json_response({"ok": True, "settings": _public_settings()})


async def api_chat(request):
    _require_user(request)
    try:
        body = await request.json()
    except Exception:
        return _err("invalid JSON")
    text = str(body.get("message") or "").strip()
    if not text:
        return _err("empty message")
    if len(text) > 2000:
        return _err("message too long")
    user = X.request_user(request)
    sid = f"web:{user}:{body.get('session') or 'default'}"
    if body.get("reset"):
        _RUNTIME["sessions"].pop(sid, None)
    try:
        reply, collector = await _converse(sid, text, "web")
    except Exception as exc:
        return _err(str(exc), 502)
    return web.json_response({
        "reply": reply,
        "actions": collector["actions"],
        "pending": collector["pending"],
    })


async def api_confirm(request):
    _require_user(request)
    try:
        body = await request.json()
    except Exception:
        return _err("invalid JSON")
    aid = str(body.get("id") or "")
    pending = _RUNTIME["pending"].get(aid)
    if not pending or time.time() - pending["ts"] > PENDING_TTL:
        _RUNTIME["pending"].pop(aid, None)
        return _err("that action has expired — ask again", 410)
    mode = _STATE["settings"]["safety"].get("mode")
    if mode == "pin" and _STATE["settings"]["safety"].get("pin"):
        if not _pin_ok(body.get("pin")):
            X.log_security("ai_assistant_bad_pin",
                           X.request_user(request) or "",
                           X.client_ip(request))
            return _err("wrong PIN", 403)
    _RUNTIME["pending"].pop(aid, None)
    results = await _execute_calls(pending["calls"])
    X.log_security("ai_assistant_confirmed_action",
                   X.request_user(request) or "", X.client_ip(request))
    return web.json_response({"ok": all(r["ok"] for r in results),
                              "results": results})


async def api_cancel(request):
    _require_user(request)
    try:
        body = await request.json()
    except Exception:
        return _err("invalid JSON")
    _RUNTIME["pending"].pop(str(body.get("id") or ""), None)
    return web.json_response({"ok": True})


async def api_test(request):
    """Round-trip test: asks the model to reply with a fixed word."""
    X.require_admin(request)
    try:
        collector = {"actions": [], "pending": None}
        provider, model = _provider_conf()
        s = _STATE["settings"]
        messages = [{"role": "user",
                     "content": "Reply with exactly: READY"}]
        if provider == "anthropic":
            text, _ = await _llm_anthropic(model, messages, collector, "test")
        elif provider == "openai":
            if not s.get("openai_key"):
                raise RuntimeError("No OpenAI API key set.")
            text, _ = await _llm_openai_compatible(
                model, messages, collector, "test", key=s.get("openai_key"))
        else:
            text, _ = await _llm_openai_compatible(
                model, messages, collector, "test",
                base_url=s.get("ollama_url") or "http://localhost:11434",
                key=s.get("custom_key") or None)
        return web.json_response({"ok": True, "provider": provider,
                                  "model": model, "reply": text[:200]})
    except Exception as exc:
        return _err(str(exc), 502)


async def api_transcribe(request):
    """Browser fallback STT (when Web Speech API is unavailable)."""
    _require_user(request)
    audio = await request.read()
    if not audio or len(audio) > 10 * 1024 * 1024:
        return _err("no audio / too large")
    text, err = await _transcribe(
        audio, filename=request.query.get("name") or "clip.webm")
    if err:
        return _err(err, 502)
    return web.json_response({"text": text})


async def api_widget_config(request):
    """Assistant name + language for the dashboard widget (no secrets)."""
    _require_user(request)
    s = _STATE["settings"]
    provider, model = _provider_conf()
    ready = bool((provider == "anthropic" and s.get("anthropic_key")) or
                 (provider == "openai" and s.get("openai_key")) or
                 provider == "ollama")
    lang = s.get("language") or "auto"
    ack = (s.get("ack_text") or "").strip()
    if not ack:
        ack = "\u062c\u0627\u0646\u0645\u061f" if lang.startswith("fa") \
            else "Yes?"
    return web.json_response({
        "assistant_name": s.get("assistant_name") or "Nova",
        "wake_aliases": s.get("wake_aliases") or "",
        "ack_text": ack,
        "language": lang,
        "ready": ready,
    })


# ---------------------------------------------------------------- lifecycle

async def _on_startup(app):
    _RUNTIME["tasks"] = [
        asyncio.create_task(_tg_loop()),
        asyncio.create_task(_area_cache_loop()),
    ]


async def _on_cleanup(app):
    for task in _RUNTIME["tasks"]:
        task.cancel()
    _RUNTIME["tasks"] = []


# ---------------------------------------------------------------- register

def register(app, ctx, manifest):
    global X
    X = ctx
    _load()

    base = "/api/tools/ai_assistant"
    app.router.add_get("/tools/ai_assistant/", page_tool)
    app.router.add_get(f"{base}/data", api_data)
    app.router.add_post(f"{base}/settings", api_settings)
    app.router.add_post(f"{base}/chat", api_chat)
    app.router.add_post(f"{base}/confirm", api_confirm)
    app.router.add_post(f"{base}/cancel", api_cancel)
    app.router.add_post(f"{base}/test", api_test)
    app.router.add_post(f"{base}/transcribe", api_transcribe)
    app.router.add_get(f"{base}/widget_config", api_widget_config)

    app.on_startup.append(_on_startup)
    app.on_cleanup.append(_on_cleanup)
