"""System Center — Advance Tools plugin.

Three jobs the add-on could not do before:

1. Support bundle
   One download that contains everything a maintainer needs to diagnose an
   installation: versions, environment, detected problems, the add-on log and
   every tool's configuration -- with all secrets stripped out.

2. Export
   Dashboards *and* every tool's configuration in one zip, so a setup can be
   moved to a new Home Assistant box, snapshotted before an experiment, or
   shared with somebody else. An export is the user's OWN data and is NOT
   redacted.

3. Import
   Upload such a zip, review exactly what it contains and what it would
   overwrite, then apply only the ticked items. Every import writes a rollback
   point first.


REDACTION RULE (support bundle only)
------------------------------------
`_redact()` is the single implementation and it is deny-by-default:

* Key names -- any dict key whose name contains, case-insensitively, one of
  password, pin, hash, token, secret, key, credential, auth, cookie, api,
  webhook, chat_id, email, phone
  has its ENTIRE value replaced with "<redacted>", including whole nested
  dicts and lists. Empty values (None, "", [], {}) are left alone: they carry
  no secret and "password: empty" is useful diagnostic information.

* Value shapes -- regardless of the key name, a string is replaced when it
  looks like a credential or like personal data: a "Bearer ..." header, a URL
  containing user:password@, an e-mail address, a bare phone number or chat
  id, a hex string of 20+ characters, or a 20+ character token-shaped string
  mixing at least two of lowercase/uppercase/digits (which catches scrypt
  hashes, base64 keys, JWTs and bot tokens). Plain paths, URLs without
  credentials, timestamps, entity ids and ordinary prose never match.

* Recursion -- dicts and lists are walked to any depth.

Over-redaction is deliberate: a support bundle that is missing a harmless
setting is a nuisance, a support bundle that leaks a token is an incident.
"""
import json
import os
import platform
import re
import shutil
import sys
import tempfile
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import aiohttp
from aiohttp import web

X = None  # core context, injected by the loader
TOOL_DIR = Path(__file__).parent

SUPERVISOR = "http://supervisor"

# Export/import archive format. Bump only on a breaking layout change.
FORMAT_VERSION = 1

# Upload / archive limits (zip-bomb protection).
MAX_UPLOAD = 32 * 1024 * 1024          # bytes accepted from the browser
MAX_ENTRIES = 4000                     # members in an uploaded archive
MAX_UNCOMPRESSED = 256 * 1024 * 1024   # total uncompressed size allowed
MAX_RATIO = 200                        # uncompressed / compressed ceiling

ROLLBACK_DIR_NAME = "system_center_rollback"
ROLLBACK_KEEP = 5

PENDING_TTL = 30 * 60                  # inspected uploads expire after 30 min
PENDING_MAX = 4

# Files in <DATA> that are never a "tool config".
DATA_SKIP = {"panel.json", "panel.tmp", "secret.key"}

_PENDING = {}      # token -> {"dir": Path, "ts": float, "report": dict}


def _err(msg, status=400):
    return web.json_response({"error": str(msg)}, status=status)


def _now_utc():
    return datetime.now(timezone.utc)


def _stamp(fmt="%Y%m%d-%H%M"):
    return _now_utc().strftime(fmt)


# ============================================================== redaction

REDACTED = "<redacted>"

SECRET_KEY_PARTS = (
    "password", "pin", "hash", "token", "secret", "key", "credential",
    "auth", "cookie", "api", "webhook", "chat_id", "email", "phone",
)

_BEARER_RE = re.compile(r"\bbearer\s+\S+", re.I)
_URL_CRED_RE = re.compile(r"[a-z][a-z0-9+.\-]*://[^/\s:@]+:[^/\s@]+@", re.I)
_HEX_RE = re.compile(r"[0-9a-fA-F]{20,}")
_TOKENISH_RE = re.compile(r"[A-Za-z0-9+/=_.:$~\-]{20,}")
_NUMERIC_RE = re.compile(r"[\d\-:.+TZ ]+")     # dates, versions, plain numbers
_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")
_PHONE_RE = re.compile(r"\+?\d[\d \-().]{7,18}\d")


def _secret_key(name):
    """True when a dict key name is one we never emit a value for."""
    low = str(name).lower()
    return any(part in low for part in SECRET_KEY_PARTS)


def _looks_secret(text):
    """True when a string looks like a credential whatever its key is called."""
    if not isinstance(text, str):
        return False
    s = text.strip()
    if _BEARER_RE.search(s) or _URL_CRED_RE.search(s):
        return True
    if _EMAIL_RE.search(s):
        return True                         # PII, wherever it is stored
    if _PHONE_RE.fullmatch(s):
        return True                         # a bare phone number / chat id
    if len(s) < 20:
        return False
    if s.startswith("/") or "://" in s:
        return False                        # a path or a plain URL
    if _NUMERIC_RE.fullmatch(s):
        return False                        # timestamp / version / number
    if not _TOKENISH_RE.fullmatch(s):
        return False                        # contains spaces or prose
    if _HEX_RE.fullmatch(s):
        return True
    if "/" in s and not any(c.isdigit() for c in s):
        return False                        # e.g. "Europe/Amsterdam"
    classes = (any(c.islower() for c in s)
               + any(c.isupper() for c in s)
               + any(c.isdigit() for c in s))
    return classes >= 2


def _is_empty(value):
    return value is None or value == "" or value == [] or value == {}


def _redact(obj, stats=None):
    """Return a redacted deep copy of obj. See the module docstring.

    stats (optional) is a dict that accumulates {"count": int, "keys": set}
    so the UI can tell the user exactly how much was removed.
    """
    if stats is None:
        stats = {"count": 0, "keys": set()}

    def note(key):
        stats["count"] = stats.get("count", 0) + 1
        if key:
            stats.setdefault("keys", set()).add(str(key))

    def walk(node, key=None):
        if isinstance(node, dict):
            out = {}
            for k, v in node.items():
                if _secret_key(k) and not _is_empty(v):
                    out[k] = REDACTED
                    note(k)
                else:
                    out[k] = walk(v, k)
            return out
        if isinstance(node, (list, tuple)):
            return [walk(v, key) for v in node]
        if isinstance(node, str) and _looks_secret(node):
            note(key)
            return REDACTED
        return node

    return walk(obj)


def _redact_text(text, stats=None):
    """Redact secrets inside a free-text blob (used for the add-on log)."""
    if stats is None:
        stats = {"count": 0, "keys": set()}
    hits = [0]

    def sub(match):
        hits[0] += 1
        return REDACTED

    out = _BEARER_RE.sub(sub, text)
    out = _URL_CRED_RE.sub(lambda m: REDACTED + "@", out)
    out = _HEX_RE.sub(sub, out)
    if hits[0]:
        stats["count"] = stats.get("count", 0) + hits[0]
        stats.setdefault("keys", set()).add("(log text)")
    return out


# ============================================================== supervisor

def _headers():
    return {"Authorization": f"Bearer {X.SUPERVISOR_TOKEN}"}


async def _sup_json(path, timeout=15):
    """GET a Supervisor endpoint. Returns (data, error_string)."""
    if not X.SUPERVISOR_TOKEN:
        return None, "no Supervisor token (running outside the Supervisor)"
    try:
        async with aiohttp.ClientSession() as s:
            async with s.get(SUPERVISOR + path, headers=_headers(),
                             timeout=aiohttp.ClientTimeout(total=timeout)) as r:
                text = await r.text()
                try:
                    body = json.loads(text) if text else {}
                except ValueError:
                    return None, f"HTTP {r.status}: unparsable response"
                if body.get("result") == "ok":
                    return body.get("data") or {}, ""
                return None, str(body.get("message") or f"HTTP {r.status}")
    except Exception as exc:
        return None, str(exc)


async def _sup_text(path, timeout=25, limit=512 * 1024):
    """GET a plain-text Supervisor endpoint (logs). Returns (text, error)."""
    if not X.SUPERVISOR_TOKEN:
        return "", "no Supervisor token (running outside the Supervisor)"
    try:
        async with aiohttp.ClientSession() as s:
            async with s.get(SUPERVISOR + path, headers=_headers(),
                             timeout=aiohttp.ClientTimeout(total=timeout)) as r:
                if r.status != 200:
                    return "", f"Supervisor returned HTTP {r.status}"
                raw = await r.content.read(limit)
                return raw.decode("utf-8", "replace"), ""
    except Exception as exc:
        return "", str(exc)


# ============================================================== data files

def _data_dir():
    return Path(X.DATA)


def _dash_dir():
    return _data_dir() / "dashboards"


def _tool_config_files():
    """Every tool's JSON config in <DATA>, sorted by name."""
    out = []
    try:
        for p in sorted(_data_dir().iterdir()):
            if p.is_file() and p.suffix == ".json" and p.name not in DATA_SKIP:
                out.append(p)
    except OSError:
        pass
    return out


def _read_json(path):
    """(data, error) — never raises."""
    try:
        return json.loads(path.read_text(encoding="utf-8")), ""
    except Exception as exc:
        return None, str(exc)


def _dashboard_summary():
    """Names/slugs/modes/widget counts/skins — never the full design."""
    rows = []
    dashboards = X.STORE.data.get("dashboards", {}) or {}
    for slug, dash in sorted(dashboards.items()):
        design_file = _dash_dir() / slug / "design.json"
        widgets, skins, types, problem = 0, set(), set(), ""
        if design_file.is_file():
            design, err = _read_json(design_file)
            if err:
                problem = f"design.json could not be parsed: {err}"
            elif isinstance(design, dict):
                for w in design.get("widgets") or []:
                    if not isinstance(w, dict):
                        continue
                    widgets += 1
                    if w.get("skin"):
                        skins.add(str(w["skin"]))
                    if w.get("type"):
                        types.add(str(w["type"]))
        entities = dash.get("entities") or []
        rows.append({
            "slug": slug,
            "name": dash.get("name", slug),
            "mode": dash.get("mode", "html"),
            "allow_all": bool(dash.get("allow_all")),
            "entities_allowed": len(entities),
            "widgets": widgets,
            "widget_types": sorted(types),
            "skins": sorted(skins),
            "has_design": design_file.is_file(),
            "problem": problem,
        })
    return rows


# ============================================================== report.md

def _fmt_uptime(seconds):
    seconds = int(seconds)
    d, rem = divmod(seconds, 86400)
    h, rem = divmod(rem, 3600)
    m = rem // 60
    if d:
        return f"{d}d {h}h {m}m"
    if h:
        return f"{h}h {m}m"
    return f"{m}m"


def _fmt_bytes(n):
    n = float(n)
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} GB"


def _detect_problems(configs, dashboards, sup_err, log_err):
    """Obvious things worth telling a maintainer about, in plain language."""
    problems = []
    if not X.HA.connected:
        problems.append(
            "Home Assistant is NOT connected. The add-on has no WebSocket "
            "link to HA Core, so every tool that reads entities is blind. "
            "This is almost always the first thing to fix.")

    notify = [e for e in X.HA.states if e.startswith("notify.")]
    if X.HA.connected and not notify:
        problems.append(
            "No notify.* entities were found. Notify Hub and any tool that "
            "sends messages will have nothing to send to.")

    for d in dashboards:
        if not d["allow_all"] and d["entities_allowed"] == 0:
            problems.append(
                f"Dashboard '{d['name']}' ({d['slug']}) has an empty entity "
                "allowlist and does not allow all entities, so it can show no "
                "live data at all.")
        if d["problem"]:
            problems.append(f"Dashboard '{d['slug']}': {d['problem']}")
        if not d["has_design"] and d["mode"] == "design":
            problems.append(
                f"Dashboard '{d['slug']}' is in design mode but has no "
                "design.json on disk.")

    for name, info in sorted(configs.items()):
        if info.get("error"):
            problems.append(
                f"Tool config {name} could not be parsed: {info['error']}. "
                "That tool is probably running on defaults.")

    if sup_err:
        problems.append(
            f"The Supervisor API could not be reached ({sup_err}). "
            "Supervisor/OS details are missing from this bundle.")
    if log_err:
        problems.append(
            f"The add-on log could not be collected ({log_err}). "
            "Ask the user for the log from Settings > Add-ons > Advance "
            "Tools > Log instead.")

    stale = [n for n, u in (X.STORE.data.get("users") or {}).items()
             if u.get("must_change_password")]
    if stale:
        problems.append(
            "Account(s) still on a temporary password: "
            + ", ".join(sorted(stale)))
    return problems


def _build_report(ctx):
    """Render report.md from the gathered context dict."""
    L = []
    add = L.append
    add("# Advance Tools — support bundle")
    add("")
    add(f"Generated: {ctx['generated']}")
    add("")
    add("This file is a summary for whoever is helping you. Every value in "
        "this bundle has been passed through an automatic redaction filter — "
        "passwords, PINs, tokens, API keys, webhooks, e-mail addresses and "
        "phone numbers were replaced with `<redacted>` before the zip was "
        "written.")
    add("")

    add("## Versions")
    add("")
    add(f"- Add-on (Advance Tools): **{ctx['app_version']}**")
    add(f"- Home Assistant Core: **{ctx['ha_version'] or 'unknown'}**")
    add(f"- Supervisor: {ctx['supervisor_version'] or 'not reachable'}")
    add(f"- Operating system: {ctx['os_name'] or 'unknown'}")
    add(f"- Machine / architecture: {ctx['machine'] or 'unknown'}")
    add(f"- Python: {ctx['python']}")
    add(f"- Platform: {ctx['platform']}")
    add("")

    add("## Runtime")
    add("")
    add(f"- Add-on uptime: {ctx['uptime']}")
    add(f"- Home Assistant connected: **{'yes' if ctx['connected'] else 'NO'}**")
    add(f"- Entities visible: {ctx['entities']} across {ctx['domains']} domains")
    add(f"- SSL: {'on' if ctx['ssl'] else 'off'}")
    add(f"- Public domain configured: {ctx['domain'] or 'no'}")
    add(f"- Ingress/sidebar port: {ctx['ingress_port']}")
    add("")

    add("## Counts")
    add("")
    add(f"- Users: {ctx['users']} ({ctx['admins']} admin)")
    add(f"- Dashboards: {ctx['dashboard_count']}")
    add(f"- Tools loaded: {ctx['tool_count']}")
    add(f"- Tool config files in /data: {ctx['config_count']}")
    add("")

    add("## Loaded tools")
    add("")
    if ctx["tools"]:
        add("| Tool | id | Version |")
        add("| --- | --- | --- |")
        for t in ctx["tools"]:
            add(f"| {t['name']} | `{t['id']}` | {t['version']} |")
    else:
        add("No tools reported as loaded — that itself is a problem.")
    add("")

    add("## Dashboards")
    add("")
    if ctx["dashboards"]:
        add("| Slug | Name | Mode | Widgets | Allowed entities | Skins |")
        add("| --- | --- | --- | --- | --- | --- |")
        for d in ctx["dashboards"]:
            allowed = "all" if d["allow_all"] else str(d["entities_allowed"])
            skins = ", ".join(d["skins"]) or "-"
            add(f"| `{d['slug']}` | {d['name']} | {d['mode']} | "
                f"{d['widgets']} | {allowed} | {skins} |")
    else:
        add("No dashboards defined yet.")
    add("")

    add("## Top entity domains")
    add("")
    if ctx["top_domains"]:
        for dom, count in ctx["top_domains"]:
            add(f"- `{dom}`: {count}")
    else:
        add("No entities are visible (see 'Problems detected').")
    add("")

    add("## Problems detected")
    add("")
    if ctx["problems"]:
        for p in ctx["problems"]:
            add(f"- ⚠ {p}")
    else:
        add("Nothing obviously wrong was found by the automatic checks. "
            "The problem is likely specific to one tool — see `config/` and "
            "`logs/addon.log`.")
    add("")

    add("## What is in this bundle")
    add("")
    for name, size in ctx["files"]:
        add(f"- `{name}` ({_fmt_bytes(size)})")
    add("")
    add(f"**{ctx['redactions']} value(s) were redacted** before this archive "
        "was written.")
    if ctx["redacted_keys"]:
        add("")
        add("Redacted field names: "
            + ", ".join(f"`{k}`" for k in ctx["redacted_keys"]))
    add("")

    add("## What is NOT in this bundle")
    add("")
    add("- No passwords, password hashes, PINs, tokens or API keys.")
    add("- No e-mail addresses, phone numbers or chat ids.")
    add("- No dashboard designs — only their names, sizes and skin names.")
    add("- No Home Assistant backups, no /config, no entity history.")
    add("")
    return "\n".join(L) + "\n"


# ============================================================== bundle

async def _gather_bundle(dest_zip):
    """Write the support bundle to dest_zip. Returns a meta dict."""
    stats = {"count": 0, "keys": set()}

    # --- tool configs, redacted
    configs = {}
    for path in _tool_config_files():
        data, err = _read_json(path)
        if err:
            configs[path.name] = {"error": err, "raw_bytes": path.stat().st_size}
        else:
            configs[path.name] = {"error": "", "data": _redact(data, stats)}

    # --- core store, redacted
    panel = _redact(X.STORE.data, stats)

    # --- dashboards summary (safe by construction, still filtered)
    dashboards = _dashboard_summary()

    # --- supervisor / OS info
    sup_info, sup_err = await _sup_json("/supervisor/info")
    os_info, _ = await _sup_json("/os/info")
    host_info, _ = await _sup_json("/host/info")
    core_info, _ = await _sup_json("/core/info")

    log_text, log_err = await _sup_text("/addons/self/logs")
    if log_text:
        log_text = _redact_text(log_text, stats)

    domains = {}
    for eid in X.HA.states:
        d = eid.split(".")[0]
        domains[d] = domains.get(d, 0) + 1
    top = sorted(domains.items(), key=lambda kv: -kv[1])[:10]

    users = X.STORE.data.get("users", {}) or {}
    tools = [{"id": t.get("id", "?"), "name": t.get("name", "?"),
              "version": t.get("version", "?")} for t in _tool_manifests()]

    problems = _detect_problems(configs, dashboards, sup_err, log_err)

    ctx = {
        "generated": _now_utc().strftime("%Y-%m-%d %H:%M:%S UTC"),
        "app_version": X.VERSION,
        "ha_version": X.HA.ha_version or (core_info or {}).get("version", ""),
        "supervisor_version": (sup_info or {}).get("version", ""),
        "os_name": (f"Home Assistant OS {(os_info or {}).get('version')}"
                    if (os_info or {}).get("version")
                    else (host_info or {}).get("operating_system", "")),
        "machine": " / ".join(
            v for v in ((host_info or {}).get("chassis", ""),
                        (sup_info or {}).get("arch", "")) if v),
        "python": sys.version.split()[0],
        "platform": f"{platform.system()} {platform.release()} "
                    f"({platform.machine()})",
        "uptime": _fmt_uptime(time.time() - _start_time()),
        "connected": X.HA.connected,
        "entities": len(X.HA.states),
        "domains": len(domains),
        "top_domains": top,
        "ssl": os.environ.get("SSL", "false").lower() == "true",
        "domain": "yes" if os.environ.get("DOMAIN", "").strip()
                  not in ("", "null") else "",
        "ingress_port": 8099,
        "users": len(users),
        "admins": sum(1 for u in users.values() if u.get("is_admin")),
        "dashboard_count": len(dashboards),
        "tool_count": len(tools),
        "config_count": len(configs),
        "tools": tools,
        "dashboards": dashboards,
        "problems": problems,
    }

    # Build the member list first so report.md can describe the archive.
    members = []

    def member(name, text):
        members.append((name, text))

    member("panel.json", json.dumps(panel, ensure_ascii=False, indent=2))
    for name, info in sorted(configs.items()):
        if info["error"]:
            body = json.dumps({"_error": "this file could not be parsed",
                               "_detail": info["error"],
                               "_bytes": info["raw_bytes"]},
                              ensure_ascii=False, indent=2)
        else:
            body = json.dumps(info["data"], ensure_ascii=False, indent=2)
        member(f"config/{name}", body)
    member("dashboards.json",
           json.dumps({"dashboards": dashboards}, ensure_ascii=False, indent=2))
    if log_text:
        member("logs/addon.log", log_text)
    member("environment.json", json.dumps({
        "python": ctx["python"], "platform": ctx["platform"],
        "supervisor": _redact(sup_info or {}, stats),
        "os": _redact(os_info or {}, stats),
        "host": _redact(host_info or {}, stats),
        "core": _redact(core_info or {}, stats),
        "supervisor_error": sup_err,
        "log_error": log_err,
    }, ensure_ascii=False, indent=2))

    sizes = [(n, len(t.encode("utf-8"))) for n, t in members]
    ctx["files"] = [("report.md", 0)] + sizes
    ctx["redactions"] = stats["count"]
    ctx["redacted_keys"] = sorted(stats["keys"])[:60]

    # report.md lists its own size, so render until that number stops moving
    # (it converges in two or three passes).
    report = _build_report(ctx)
    for _ in range(4):
        size = len(report.encode("utf-8"))
        if ctx["files"][0][1] == size:
            break
        ctx["files"] = [("report.md", size)] + sizes
        report = _build_report(ctx)

    with zipfile.ZipFile(dest_zip, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("report.md", report)
        for name, text in members:
            z.writestr(name, text)

    listing = []
    with zipfile.ZipFile(dest_zip) as z:
        for info in z.infolist():
            listing.append({"name": info.filename, "bytes": info.file_size})

    return {
        "files": listing,
        "redactions": stats["count"],
        "redacted_keys": sorted(stats["keys"]),
        "problems": problems,
        "report": report,
        "log_included": bool(log_text),
        "log_error": log_err,
        "zip_bytes": dest_zip.stat().st_size,
    }


_FALLBACK_START = time.time()      # this module is imported during boot


def _start_time():
    """Add-on start time (the loader may expose the real one one day)."""
    return getattr(X, "START_TIME", None) or _FALLBACK_START


def _tool_manifests():
    """Loaded tool manifests. main.py keeps the list; fall back to disk."""
    tools = getattr(X, "TOOLS", None)
    if isinstance(tools, list) and tools:
        return tools
    out = []
    tdir = Path(X.APP) / "tools"
    if tdir.is_dir():
        for sub in sorted(tdir.iterdir()):
            mf = sub / "manifest.json"
            if mf.is_file():
                data, err = _read_json(mf)
                if not err and isinstance(data, dict):
                    out.append(data)
    return out


# ============================================================== export

VALID_PARTS = ("dashboards", "tools", "users")


def _parse_include(request):
    raw = request.query.get("include", "dashboards,tools,users")
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    parts = [p for p in parts if p in VALID_PARTS]
    return parts or list(VALID_PARTS)


def _safe_slug(slug):
    return bool(X.SLUG_RE.match(str(slug or "")))


def _build_export(dest_zip, parts, credentials):
    """Write the setup export to dest_zip. Returns a meta dict."""
    counts = {"dashboards": 0, "dashboard_files": 0, "tools": 0, "users": 0}
    manifest = {
        "format": FORMAT_VERSION,
        "app": "Advance Tools",
        "app_version": X.VERSION,
        "exported": _now_utc().isoformat(timespec="seconds"),
        "includes": parts,
        "credentials": bool(credentials),
    }

    with zipfile.ZipFile(dest_zip, "w", zipfile.ZIP_DEFLATED) as z:
        if "dashboards" in parts:
            dashboards = X.STORE.data.get("dashboards", {}) or {}
            z.writestr("dashboards.json",
                       json.dumps(dashboards, ensure_ascii=False, indent=2))
            counts["dashboards"] = len(dashboards)
            for slug in dashboards:
                d = _dash_dir() / slug
                if not (_safe_slug(slug) and d.is_dir()):
                    continue
                for f in sorted(d.rglob("*")):
                    if not f.is_file() or f.is_symlink():
                        continue
                    rel = f.relative_to(_dash_dir()).as_posix()
                    z.write(f, f"dashboards/{rel}")
                    counts["dashboard_files"] += 1

        if "tools" in parts:
            for p in _tool_config_files():
                z.write(p, f"config/{p.name}")
                counts["tools"] += 1
            packs = _data_dir() / "packs.json"
            if packs.is_file() and packs.name not in {
                    q.name for q in _tool_config_files()}:
                z.write(packs, "config/packs.json")
                counts["tools"] += 1

        if "users" in parts:
            users = {}
            for name, u in (X.STORE.data.get("users") or {}).items():
                rec = {
                    "is_admin": bool(u.get("is_admin")),
                    "dashboards": list(u.get("dashboards") or []),
                }
                if credentials and u.get("password"):
                    rec["password"] = u["password"]
                if u.get("must_change_password"):
                    rec["must_change_password"] = True
                users[name] = rec
            z.writestr("users.json",
                       json.dumps(users, ensure_ascii=False, indent=2))
            counts["users"] = len(users)

        manifest["counts"] = counts
        z.writestr("manifest.json",
                   json.dumps(manifest, ensure_ascii=False, indent=2))

    listing = []
    with zipfile.ZipFile(dest_zip) as z:
        for info in z.infolist():
            listing.append({"name": info.filename, "bytes": info.file_size})
    return {"manifest": manifest, "counts": counts, "files": listing,
            "zip_bytes": dest_zip.stat().st_size}


# ============================================================== zip safety

_MEMBER_RE = re.compile(r"^[A-Za-z0-9._\-/ ]{1,200}$")


def _safe_member(name):
    """(ok, reason) for one archive member path."""
    if not name or name.endswith("/"):
        return False, "directory entry"
    if not _MEMBER_RE.match(name):
        return False, "illegal characters in the path"
    if name.startswith("/") or name.startswith("\\"):
        return False, "absolute path"
    if re.match(r"^[A-Za-z]:", name):
        return False, "absolute Windows path"
    parts = name.split("/")
    if any(p in ("", ".", "..") for p in parts):
        return False, "path traversal ('..')"
    if len(parts) > 6:
        return False, "path nested too deeply"
    return True, ""


def _inspect_archive(path):
    """Validate an uploaded zip. Returns (zipfile-safe member list, warnings).

    Raises ValueError with a user-facing message when the archive must be
    rejected outright.
    """
    warnings = []
    try:
        z = zipfile.ZipFile(path)
    except Exception as exc:
        raise ValueError(f"this file is not a readable zip archive ({exc})")

    with z:
        infos = z.infolist()
        if len(infos) > MAX_ENTRIES:
            raise ValueError(
                f"archive rejected: {len(infos)} entries, the limit is "
                f"{MAX_ENTRIES}")
        total = sum(i.file_size for i in infos)
        packed = sum(i.compress_size for i in infos) or 1
        if total > MAX_UNCOMPRESSED:
            raise ValueError(
                f"archive rejected: it would unpack to "
                f"{_fmt_bytes(total)}, the limit is "
                f"{_fmt_bytes(MAX_UNCOMPRESSED)}")
        if total / packed > MAX_RATIO and total > 8 * 1024 * 1024:
            raise ValueError(
                "archive rejected: the compression ratio looks like a zip "
                "bomb")

        members = []
        for info in infos:
            if info.filename.endswith("/"):
                continue
            mode = (info.external_attr >> 16) & 0o170000
            if mode == 0o120000:
                warnings.append(
                    f"skipped '{info.filename}': symlinks are not allowed")
                continue
            ok, why = _safe_member(info.filename)
            if not ok:
                warnings.append(f"skipped '{info.filename}': {why}")
                continue
            members.append(info.filename)
    return members, warnings


def _extract_to(zip_path, members, dest):
    """Extract exactly the given members below dest, path-checked again."""
    dest = dest.resolve()
    with zipfile.ZipFile(zip_path) as z:
        for name in members:
            ok, _why = _safe_member(name)
            if not ok:
                continue
            target = (dest / name).resolve()
            if not str(target).startswith(str(dest) + os.sep):
                continue                     # belt and braces
            target.parent.mkdir(parents=True, exist_ok=True)
            with z.open(name) as src, target.open("wb") as out:
                shutil.copyfileobj(src, out, 1 << 16)


# ============================================================== rollback

def _rollback_root():
    return _data_dir() / ROLLBACK_DIR_NAME


def _new_rollback(reason):
    root = _rollback_root()
    root.mkdir(parents=True, exist_ok=True)
    point = root / _stamp("%Y%m%d-%H%M%S")
    n = 1
    while point.exists():
        n += 1
        point = root / (_stamp("%Y%m%d-%H%M%S") + f"-{n}")
    point.mkdir(parents=True)
    (point / "meta.json").write_text(json.dumps({
        "created": _now_utc().isoformat(timespec="seconds"),
        "reason": reason,
        "app_version": X.VERSION,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    return point


def _rollback_save_file(point, path):
    """Copy one <DATA> file into the rollback point (keeping its name)."""
    if not path.is_file():
        return
    files = point / "files"
    files.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, files / path.name)


def _rollback_save_dashboard(point, slug):
    src = _dash_dir() / slug
    if not src.is_dir():
        return
    dst = point / "dashboards" / slug
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists():
        shutil.rmtree(dst, ignore_errors=True)
    shutil.copytree(src, dst)


def _prune_rollbacks():
    root = _rollback_root()
    if not root.is_dir():
        return
    points = sorted([p for p in root.iterdir() if p.is_dir()])
    for old in points[:-ROLLBACK_KEEP]:
        shutil.rmtree(old, ignore_errors=True)


def _list_rollbacks():
    root = _rollback_root()
    out = []
    if not root.is_dir():
        return out
    for p in sorted([q for q in root.iterdir() if q.is_dir()], reverse=True):
        meta, _err = _read_json(p / "meta.json")
        meta = meta if isinstance(meta, dict) else {}
        files = sorted(f.name for f in (p / "files").glob("*")) \
            if (p / "files").is_dir() else []
        dashes = sorted(d.name for d in (p / "dashboards").iterdir()) \
            if (p / "dashboards").is_dir() else []
        out.append({
            "id": p.name,
            "created": meta.get("created", ""),
            "reason": meta.get("reason", ""),
            "app_version": meta.get("app_version", ""),
            "files": files,
            "dashboards": dashes,
        })
    return out


def _apply_rollback(point):
    """Restore a rollback point. Returns a list of result rows."""
    results = []
    files = point / "files"
    if files.is_dir():
        for f in sorted(files.iterdir()):
            if not f.is_file() or f.name == "meta.json":
                continue
            try:
                shutil.copy2(f, _data_dir() / f.name)
                results.append({"item": f.name, "ok": True,
                                "detail": "restored"})
            except Exception as exc:
                results.append({"item": f.name, "ok": False,
                                "detail": str(exc)})
    dashes = point / "dashboards"
    if dashes.is_dir():
        for d in sorted(dashes.iterdir()):
            if not d.is_dir() or not _safe_slug(d.name):
                continue
            target = _dash_dir() / d.name
            try:
                if target.exists():
                    shutil.rmtree(target, ignore_errors=True)
                shutil.copytree(d, target)
                results.append({"item": f"dashboard {d.name}", "ok": True,
                                "detail": "restored"})
            except Exception as exc:
                results.append({"item": f"dashboard {d.name}", "ok": False,
                                "detail": str(exc)})
    return results


# ============================================================== import

def _drop_pending(token):
    rec = _PENDING.pop(token, None)
    if rec:
        shutil.rmtree(rec.get("root") or rec["dir"], ignore_errors=True)


def _prune_pending():
    now = time.time()
    for token, rec in list(_PENDING.items()):
        if now - rec["ts"] > PENDING_TTL:
            _drop_pending(token)
    while len(_PENDING) > PENDING_MAX:
        _drop_pending(min(_PENDING, key=lambda t: _PENDING[t]["ts"]))


async def _read_upload(request):
    """Read the uploaded archive to a temp file. Returns (Path, error)."""
    tmp = Path(tempfile.mkdtemp(prefix="sc_up_")) / "upload.zip"
    total = 0
    ctype = (request.headers.get("Content-Type") or "").lower()
    try:
        with tmp.open("wb") as out:
            if ctype.startswith("multipart/"):
                reader = await request.multipart()
                field = None
                while True:
                    field = await reader.next()
                    if field is None:
                        break
                    if field.filename:
                        break
                if field is None:
                    return None, "no file was included in the upload"
                while True:
                    chunk = await field.read_chunk(1 << 16)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > MAX_UPLOAD:
                        return None, (f"file too large — the limit is "
                                      f"{_fmt_bytes(MAX_UPLOAD)}")
                    out.write(chunk)
            else:
                while True:
                    chunk = await request.content.read(1 << 16)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > MAX_UPLOAD:
                        return None, (f"file too large — the limit is "
                                      f"{_fmt_bytes(MAX_UPLOAD)}")
                    out.write(chunk)
    except Exception as exc:
        return None, str(exc)
    if total == 0:
        return None, "the upload was empty"
    return tmp, ""


def _version_tuple(text):
    out = []
    for part in re.split(r"[.\-+]", str(text or "")):
        out.append(int(part) if part.isdigit() else 0)
    return tuple(out[:3] or (0,))


def _describe_import(work):
    """Read an extracted archive dir and describe what it holds."""
    warnings = []
    manifest, err = _read_json(work / "manifest.json")
    if err or not isinstance(manifest, dict):
        raise ValueError(
            "this archive has no readable manifest.json — it was not created "
            "by System Center's Export")
    fmt = manifest.get("format")
    if not isinstance(fmt, int) or fmt != FORMAT_VERSION:
        raise ValueError(
            f"unsupported archive format '{fmt}'. This add-on understands "
            f"format {FORMAT_VERSION} only — update Advance Tools, or export "
            "again from the source system.")
    if _version_tuple(manifest.get("app_version")) > _version_tuple(X.VERSION):
        warnings.append(
            f"this archive came from Advance Tools "
            f"{manifest.get('app_version')} and you are running {X.VERSION}. "
            "Newer settings may be ignored — updating first is safer.")

    local_dash = X.STORE.data.get("dashboards", {}) or {}
    dashboards = []
    dash_json, derr = _read_json(work / "dashboards.json")
    if (work / "dashboards.json").is_file():
        if derr or not isinstance(dash_json, dict):
            warnings.append(f"dashboards.json is unreadable ({derr})")
            dash_json = {}
        for slug, dash in sorted(dash_json.items()):
            if not _safe_slug(slug):
                warnings.append(f"skipped dashboard '{slug}': illegal slug")
                continue
            files = 0
            ddir = work / "dashboards" / slug
            if ddir.is_dir():
                files = sum(1 for f in ddir.rglob("*") if f.is_file())
            dashboards.append({
                "slug": slug,
                "name": (dash or {}).get("name", slug),
                "mode": (dash or {}).get("mode", "html"),
                "files": files,
                "exists": slug in local_dash,
            })

    tools = []
    cdir = work / "config"
    if cdir.is_dir():
        for f in sorted(cdir.iterdir()):
            if not f.is_file() or f.suffix != ".json":
                continue
            if f.name in DATA_SKIP:
                warnings.append(f"skipped '{f.name}': reserved file name")
                continue
            data, ferr = _read_json(f)
            if ferr:
                warnings.append(f"skipped config '{f.name}': not valid JSON")
                continue
            tools.append({
                "file": f.name,
                "bytes": f.stat().st_size,
                "exists": (_data_dir() / f.name).is_file(),
            })

    users = []
    local_users = X.STORE.data.get("users", {}) or {}
    ujson, uerr = _read_json(work / "users.json")
    if (work / "users.json").is_file():
        if uerr or not isinstance(ujson, dict):
            warnings.append(f"users.json is unreadable ({uerr})")
            ujson = {}
        for name, rec in sorted(ujson.items()):
            if not re.match(r"^[a-zA-Z0-9_.\-]{1,40}$", str(name)):
                warnings.append(f"skipped user '{name}': illegal name")
                continue
            users.append({
                "name": name,
                "is_admin": bool((rec or {}).get("is_admin")),
                "dashboards": list((rec or {}).get("dashboards") or []),
                "has_password": bool((rec or {}).get("password")),
                "exists": name in local_users,
            })

    if not (dashboards or tools or users):
        warnings.append(
            "this archive contains nothing this add-on can import")

    return {"manifest": manifest, "dashboards": dashboards, "tools": tools,
            "users": users, "warnings": warnings}


def _lockout_check(current_user, selected_users, report):
    """Refuse imports that would delete or demote the signed-in admin."""
    by_name = {u["name"]: u for u in report["users"]}
    for name in selected_users:
        if name != current_user:
            continue
        rec = by_name.get(name)
        if rec and not rec["is_admin"]:
            return (f"Refused: this import would turn your own account "
                    f"'{current_user}' into a non-admin user and lock you out "
                    "of System Center. Untick that account, or import it from "
                    "a different admin account.")
    return ""


# ============================================================== pages / API

async def page_tool(request):
    if not X.is_admin(request):
        raise web.HTTPFound("/?d=__admin__")
    return web.FileResponse(TOOL_DIR / "static" / "index.html")


async def api_overview(request):
    X.require_admin(request)
    users = X.STORE.data.get("users", {}) or {}
    dash = _dashboard_summary()
    configs = _tool_config_files()
    return web.json_response({
        "app_version": X.VERSION,
        "ha_version": X.HA.ha_version,
        "connected": X.HA.connected,
        "entities": len(X.HA.states),
        "users": len(users),
        "admins": sum(1 for u in users.values() if u.get("is_admin")),
        "dashboards": len(dash),
        "tools": len(_tool_manifests()),
        "configs": [{"file": p.name, "bytes": p.stat().st_size}
                    for p in configs],
        "me": X.request_user(request),
        "rollbacks": len(_list_rollbacks()),
        "format": FORMAT_VERSION,
    })


async def api_bundle_preview(request):
    """Build the real bundle, describe it, then throw it away."""
    X.require_admin(request)
    tmpdir = Path(tempfile.mkdtemp(prefix="sc_prev_"))
    try:
        target = tmpdir / "bundle.zip"
        meta = await _gather_bundle(target)
        meta.pop("report", None)
        return web.json_response(meta)
    except Exception as exc:
        X.log.exception("system_center: bundle preview failed")
        return _err(f"could not build the preview: {exc}", 500)
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


async def api_bundle(request):
    X.require_admin(request)
    tmpdir = Path(tempfile.mkdtemp(prefix="sc_bundle_"))
    try:
        target = tmpdir / "bundle.zip"
        await _gather_bundle(target)
        name = f"advance-tools-support-{_stamp()}.zip"
        resp = web.StreamResponse(headers={
            "Content-Type": "application/zip",
            "Content-Length": str(target.stat().st_size),
            "Content-Disposition": f'attachment; filename="{name}"',
        })
        await resp.prepare(request)
        with target.open("rb") as f:
            while True:
                chunk = f.read(1 << 16)
                if not chunk:
                    break
                await resp.write(chunk)
        await resp.write_eof()
        X.log.info("system_center: support bundle downloaded by %s",
                   X.request_user(request))
        return resp
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


async def api_export_preview(request):
    X.require_admin(request)
    parts = _parse_include(request)
    credentials = request.query.get("credentials") == "1"
    tmpdir = Path(tempfile.mkdtemp(prefix="sc_exprev_"))
    try:
        target = tmpdir / "export.zip"
        meta = _build_export(target, parts, credentials)
        return web.json_response(meta)
    except Exception as exc:
        X.log.exception("system_center: export preview failed")
        return _err(f"could not build the preview: {exc}", 500)
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


async def api_export(request):
    X.require_admin(request)
    parts = _parse_include(request)
    credentials = request.query.get("credentials") == "1"
    tmpdir = Path(tempfile.mkdtemp(prefix="sc_export_"))
    try:
        target = tmpdir / "export.zip"
        _build_export(target, parts, credentials)
        name = f"advance-tools-setup-{_stamp('%Y%m%d')}.zip"
        resp = web.StreamResponse(headers={
            "Content-Type": "application/zip",
            "Content-Length": str(target.stat().st_size),
            "Content-Disposition": f'attachment; filename="{name}"',
        })
        await resp.prepare(request)
        with target.open("rb") as f:
            while True:
                chunk = f.read(1 << 16)
                if not chunk:
                    break
                await resp.write(chunk)
        await resp.write_eof()
        X.log.info("system_center: setup exported by %s (%s, credentials=%s)",
                   X.request_user(request), ",".join(parts), credentials)
        return resp
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


async def api_import_inspect(request):
    X.require_admin(request)
    _prune_pending()
    upload, err = await _read_upload(request)
    if err:
        return _err(err, 400)
    work = upload.parent / "unpacked"
    try:
        members, warnings = _inspect_archive(upload)
        work.mkdir(parents=True, exist_ok=True)
        _extract_to(upload, members, work)
        report = _describe_import(work)
    except ValueError as exc:
        shutil.rmtree(upload.parent, ignore_errors=True)
        return _err(str(exc), 400)
    except Exception as exc:
        X.log.exception("system_center: import inspect failed")
        shutil.rmtree(upload.parent, ignore_errors=True)
        return _err(f"could not read the archive: {exc}", 400)

    report["warnings"] = warnings + report["warnings"]
    token = _stamp("%Y%m%d%H%M%S") + "-" + os.urandom(6).hex()
    _PENDING[token] = {"dir": work, "ts": time.time(), "report": report,
                       "root": upload.parent}
    _prune_pending()
    upload.unlink(missing_ok=True)
    out = dict(report)
    out["token"] = token
    return web.json_response(out)


def _merge_dict(existing, incoming):
    out = dict(existing or {})
    out.update(incoming or {})
    return out


async def api_import_apply(request):
    current = X.require_admin(request)
    body = await request.json()
    token = str(body.get("token") or "")
    rec = _PENDING.get(token)
    if not rec:
        return _err("this upload has expired — please inspect the file again",
                    400)
    work = rec["dir"]
    report = rec["report"]
    mode = body.get("mode") if body.get("mode") in ("merge", "replace") \
        else "merge"

    want_dash = [s for s in (body.get("dashboards") or [])
                 if any(d["slug"] == s for d in report["dashboards"])]
    want_tools = [f for f in (body.get("tools") or [])
                  if any(t["file"] == f for t in report["tools"])]
    want_users = [u for u in (body.get("users") or [])
                  if any(x["name"] == u for x in report["users"])]

    if not (want_dash or want_tools or want_users):
        return _err("nothing was selected to import", 400)

    problem = _lockout_check(current, want_users, report)
    if problem:
        return _err(problem, 409)

    results = []
    point = _new_rollback(f"import by {current} ({mode})")

    async with X.STORE.lock:
        # ---- always snapshot the core store first
        _rollback_save_file(point, Path(X.DATA) / "panel.json")

        # ---- tool configs
        for name in want_tools:
            src = work / "config" / name
            dst = _data_dir() / name
            existed = dst.is_file()
            try:
                if existed:
                    _rollback_save_file(point, dst)
                incoming, ferr = _read_json(src)
                if ferr:
                    raise ValueError(ferr)
                if mode == "merge" and existed \
                        and isinstance(incoming, dict):
                    local, lerr = _read_json(dst)
                    if not lerr and isinstance(local, dict):
                        incoming = _merge_dict(local, incoming)
                tmp = dst.with_suffix(".sctmp")
                tmp.write_text(json.dumps(incoming, ensure_ascii=False,
                                          indent=2), encoding="utf-8")
                tmp.replace(dst)
                results.append({"item": name, "kind": "tool", "ok": True,
                                "detail": "overwritten" if existed
                                else "created"})
            except Exception as exc:
                results.append({"item": name, "kind": "tool", "ok": False,
                                "detail": str(exc)})

        # ---- dashboards
        dash_json, _e = _read_json(work / "dashboards.json")
        dash_json = dash_json if isinstance(dash_json, dict) else {}
        for slug in want_dash:
            try:
                if not _safe_slug(slug):
                    raise ValueError("illegal slug")
                existed = slug in X.STORE.data["dashboards"]
                if existed:
                    _rollback_save_dashboard(point, slug)
                incoming = dash_json.get(slug) or {}
                if mode == "merge" and existed:
                    incoming = _merge_dict(
                        X.STORE.data["dashboards"][slug], incoming)
                X.STORE.data["dashboards"][slug] = incoming

                src = work / "dashboards" / slug
                dst = _dash_dir() / slug
                if src.is_dir():
                    if mode == "replace" and dst.exists():
                        shutil.rmtree(dst, ignore_errors=True)
                    dst.mkdir(parents=True, exist_ok=True)
                    for f in sorted(src.rglob("*")):
                        if not f.is_file():
                            continue
                        rel = f.relative_to(src)
                        target = dst / rel
                        target.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(f, target)
                results.append({
                    "item": slug, "kind": "dashboard", "ok": True,
                    "detail": ("overwritten" if existed else "created")
                    + (" (no files in archive)" if not src.is_dir() else "")})
            except Exception as exc:
                results.append({"item": slug, "kind": "dashboard",
                                "ok": False, "detail": str(exc)})

        # ---- users
        ujson, _e = _read_json(work / "users.json")
        ujson = ujson if isinstance(ujson, dict) else {}
        for name in want_users:
            try:
                incoming = ujson.get(name) or {}
                existing = X.STORE.data["users"].get(name) or {}
                rec_out = dict(existing) if mode == "merge" else {}
                rec_out["is_admin"] = bool(incoming.get("is_admin"))
                rec_out["dashboards"] = list(incoming.get("dashboards") or [])
                note = "overwritten" if existing else "created"
                if name == current:
                    # Never change the credentials of the account doing the
                    # import — that is the classic way to lock yourself out.
                    rec_out["password"] = existing.get("password", "")
                    rec_out["is_admin"] = True
                    rec_out.pop("must_change_password", None)
                    note += " (your own password and admin rights were kept)"
                elif incoming.get("password"):
                    rec_out["password"] = incoming["password"]
                elif existing.get("password"):
                    rec_out["password"] = existing["password"]
                else:
                    # The archive carries no hash (the normal, safer export).
                    # Recreate the account with an unusable random password so
                    # nobody can sign in until an admin sets a real one from
                    # the Hub. Never leave the password field empty.
                    rec_out["password"] = X.hash_password(os.urandom(32).hex())
                    rec_out["must_change_password"] = True
                    note += (" — set a password for this account in the Hub "
                             "before it can sign in")
                if incoming.get("must_change_password") and name != current:
                    rec_out["must_change_password"] = True
                X.STORE.data["users"][name] = rec_out
                results.append({"item": name, "kind": "user", "ok": True,
                                "detail": note})
            except Exception as exc:
                results.append({"item": name, "kind": "user", "ok": False,
                                "detail": str(exc)})

        # ---- safety net: the operator must still be an admin
        me = X.STORE.data["users"].get(current)
        if not me or not me.get("is_admin"):
            X.log.error("system_center: import would have removed admin %r — "
                        "rolling back", current)
            _apply_rollback(point)
            X.STORE.load()
            return _err(
                f"Refused and rolled back: the result would have left your "
                f"account '{current}' without admin rights.", 409)

        X.STORE.save()

    _prune_rollbacks()
    _drop_pending(token)

    ok = sum(1 for r in results if r["ok"])
    X.log.info("system_center: import by %s applied %d/%d item(s), "
               "rollback point %s", current, ok, len(results), point.name)
    return web.json_response({
        "ok": True, "mode": mode, "results": results,
        "applied": ok, "failed": len(results) - ok,
        "rollback": point.name,
    })


async def api_rollback_list(request):
    X.require_admin(request)
    return web.json_response({"points": _list_rollbacks(),
                              "keep": ROLLBACK_KEEP})


async def api_rollback_apply(request):
    current = X.require_admin(request)
    body = await request.json() if request.can_read_body else {}
    points = _list_rollbacks()
    if not points:
        return _err("there is no restore point to roll back to", 404)
    wanted = str((body or {}).get("id") or points[0]["id"])
    if not re.match(r"^[0-9\-]{1,32}$", wanted) or \
            not any(p["id"] == wanted for p in points):
        return _err("unknown restore point", 404)
    point = _rollback_root() / wanted

    async with X.STORE.lock:
        safety = _new_rollback(f"automatic snapshot before rollback by {current}")
        _rollback_save_file(safety, Path(X.DATA) / "panel.json")
        for p in _tool_config_files():
            _rollback_save_file(safety, p)
        results = _apply_rollback(point)
        X.STORE.load()
        me = X.STORE.data.get("users", {}).get(current)
        if not me or not me.get("is_admin"):
            _apply_rollback(safety)
            X.STORE.load()
            return _err(
                f"Refused: restoring that point would leave your account "
                f"'{current}' without admin rights. Nothing was changed.", 409)

    _prune_rollbacks()
    X.log.info("system_center: rollback to %s by %s (%d item(s))",
               wanted, current, len(results))
    return web.json_response({"ok": True, "id": wanted, "results": results})


# ============================================================== register

def register(app, ctx, manifest):
    global X, TOOL_DIR
    X = ctx
    TOOL_DIR = Path(ctx.APP) / "tools" / "system_center"

    base = "/api/tools/system_center"
    app.router.add_get("/tools/system_center/", page_tool)
    app.router.add_get(f"{base}/overview", api_overview)
    app.router.add_get(f"{base}/bundle/preview", api_bundle_preview)
    app.router.add_get(f"{base}/bundle", api_bundle)
    app.router.add_get(f"{base}/export/preview", api_export_preview)
    app.router.add_get(f"{base}/export", api_export)
    app.router.add_post(f"{base}/import/inspect", api_import_inspect)
    app.router.add_post(f"{base}/import/apply", api_import_apply)
    app.router.add_get(f"{base}/rollback", api_rollback_list)
    app.router.add_post(f"{base}/import/rollback", api_rollback_apply)
