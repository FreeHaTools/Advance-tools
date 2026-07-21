"""Energy Center — Advance Tools plugin.

Energy consumption + cost dashboard built on Home Assistant's recorder
long-term statistics — the exact same data HA's own Energy dashboard uses,
so it survives recorder purges and works for any total_increasing energy
sensor (smart plugs, utility meters, Riemann/Integral helpers, …).

* GET  /sensors  — every statistic with an energy unit (kWh / Wh / MWh),
                   flagged whether it is currently tracked.
* GET  /config   — price per kWh, currency symbol, tracked ids, labels.
* POST /config   — save the same (persisted in /data/energy_center.json).
* GET  /report   — per-sensor consumption + cost for a range
                   (today / yesterday / week / month), bucketed hourly or
                   daily through recorder/statistics_during_period with
                   types=["change"], all unit conversion done here.
* GET  /api/dash/energy_center/summary — read-only summary for dashboard
                   widgets (wall tablets). NOT admin-gated: any logged-in
                   user with access to the dashboard given in ?d=<slug> may
                   read it (unless "allow_dashboards" is switched off in the
                   tool config). Cached per range for 120 s so polling
                   dashboards never hammer the recorder.
"""
import asyncio
import json
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from aiohttp import web

X = None  # core context, injected by the loader
TOOL_DIR = Path(__file__).parent

ENERGY_UNITS = ("kWh", "Wh", "MWh")
RANGES = ("today", "yesterday", "week", "month")

DEFAULT_CONFIG = {
    "price_per_kwh": 0.0,
    "currency": "$",
    "tracked": [],
    "labels": {},
    "allow_dashboards": True,
}

SUMMARY_TTL = 120           # seconds a dashboard summary stays cached

_lock = asyncio.Lock()
_tz_cache = None
_summary_cache = {}         # range -> (expires_monotonic, payload)


def _err(exc_or_msg, status=502):
    return web.json_response({"error": str(exc_or_msg)}, status=status)


# ---------------------------------------------------------------- config file

def _conf_file():
    return X.DATA / "energy_center.json"


async def _load_config():
    async with _lock:
        cfg = dict(DEFAULT_CONFIG)
        try:
            if _conf_file().exists():
                raw = json.loads(_conf_file().read_text(encoding="utf-8"))
                if isinstance(raw, dict):
                    cfg.update(raw)
        except Exception:
            X.log.exception("energy_center: bad config file — using defaults")
        # normalise
        cfg["price_per_kwh"] = float(cfg.get("price_per_kwh") or 0.0)
        cfg["currency"] = str(cfg.get("currency") or "$")[:8]
        cfg["tracked"] = [str(s) for s in (cfg.get("tracked") or [])]
        labels = cfg.get("labels") or {}
        cfg["labels"] = {str(k): str(v) for k, v in labels.items()
                         if isinstance(labels, dict) and str(v).strip()}
        cfg["allow_dashboards"] = bool(cfg.get("allow_dashboards", True))
        return cfg


async def _save_config(cfg):
    async with _lock:
        tmp = _conf_file().with_suffix(".tmp")
        tmp.write_text(json.dumps(cfg, ensure_ascii=False, indent=2),
                       encoding="utf-8")
        tmp.replace(_conf_file())


# ---------------------------------------------------------------- helpers

def _to_kwh(value, unit):
    """Convert a statistics value to kWh based on the statistic's unit."""
    try:
        v = float(value)
    except (TypeError, ValueError):
        return 0.0
    if unit == "Wh":
        return v / 1000.0
    if unit == "MWh":
        return v * 1000.0
    return v  # kWh (or unknown — assume kWh)


def _ts_ms(v):
    """Statistics bucket 'start' → epoch ms. HA sends epoch ms since 2023.3,
    older versions sent ISO strings — accept both."""
    if isinstance(v, (int, float)):
        return int(v)
    try:
        s = str(v).replace("Z", "+00:00")
        return int(datetime.fromisoformat(s).timestamp() * 1000)
    except Exception:
        return None


def _friendly(stat_id, cfg, meta_name=None):
    """Best display name: user label > entity friendly_name > meta > id."""
    label = cfg["labels"].get(stat_id)
    if label:
        return label
    if stat_id and "." in stat_id:
        st = X.HA.states.get(stat_id)
        if st:
            fn = (st.get("attributes") or {}).get("friendly_name")
            if fn:
                return fn
    return meta_name or stat_id


async def _local_tz():
    """HA's configured time zone (cached), falling back to the container's."""
    global _tz_cache
    if _tz_cache is not None:
        return _tz_cache
    try:
        conf = await X.HA.ws_call({"type": "get_config"})
        name = (conf or {}).get("time_zone")
        if name:
            from zoneinfo import ZoneInfo
            _tz_cache = ZoneInfo(name)
            return _tz_cache
    except Exception:
        pass
    return datetime.now().astimezone().tzinfo  # not cached — retry next time


def _range_bounds(rng, now_local):
    """(start_local, end_local_or_None, period) for a report range."""
    midnight = now_local.replace(hour=0, minute=0, second=0, microsecond=0)
    if rng == "yesterday":
        return midnight - timedelta(days=1), midnight, "hour"
    if rng == "week":
        return midnight - timedelta(days=midnight.weekday()), None, "day"
    if rng == "month":
        return midnight.replace(day=1), None, "day"
    return midnight, None, "hour"  # today


async def _units_for(stat_ids):
    """statistic_id -> display unit, from the recorder metadata."""
    units = {}
    try:
        metas = await X.HA.ws_call({"type": "recorder/get_statistics_metadata",
                                    "statistic_ids": list(stat_ids)})
        for m in metas or []:
            units[m.get("statistic_id")] = (
                m.get("display_unit_of_measurement")
                or m.get("unit_of_measurement") or "kWh")
    except Exception:
        X.log.warning("energy_center: get_statistics_metadata failed — "
                      "assuming kWh for all tracked sensors")
    return units


# ---------------------------------------------------------------- pages

async def page_tool(request):
    if not X.is_admin(request):
        raise web.HTTPFound("/?d=__admin__")
    return web.FileResponse(TOOL_DIR / "static" / "index.html")


# ---------------------------------------------------------------- API: sensors

async def api_sensors(request):
    """All statistics with an energy unit, flagged whether tracked."""
    X.require_admin(request)
    cfg = await _load_config()
    if not X.HA.connected:
        return web.json_response({
            "connected": False, "sensors": [],
            "message": "Not connected to Home Assistant yet — "
                       "try again in a few seconds."})
    try:
        metas = await X.HA.ws_call({"type": "recorder/list_statistic_ids",
                                    "statistic_type": "sum"})
    except Exception as exc:
        return _err(exc)

    out = []
    for meta in metas or []:
        unit = (meta.get("display_unit_of_measurement")
                or meta.get("unit_of_measurement") or "")
        if unit not in ENERGY_UNITS:
            continue
        sid = meta.get("statistic_id")
        if not sid:
            continue
        st = X.HA.states.get(sid) if "." in sid else None
        out.append({
            "id": sid,
            "name": _friendly(sid, cfg, meta.get("name")),
            "unit": unit,
            "tracked": sid in cfg["tracked"],
            "source": "entity" if st else "external",
            "state": st.get("state") if st else None,
        })
    out.sort(key=lambda s: (not s["tracked"], str(s["name"]).lower()))
    return web.json_response({"connected": True, "sensors": out,
                              "tracked": cfg["tracked"]})


# ---------------------------------------------------------------- API: config

async def api_config_get(request):
    X.require_admin(request)
    cfg = await _load_config()
    return web.json_response(cfg)


async def api_config_post(request):
    X.require_admin(request)
    try:
        body = await request.json()
    except Exception:
        return _err("invalid JSON body", 400)
    if not isinstance(body, dict):
        return _err("body must be an object", 400)

    cfg = await _load_config()

    if "price_per_kwh" in body:
        try:
            price = float(body["price_per_kwh"])
        except (TypeError, ValueError):
            return _err("price_per_kwh must be a number", 400)
        if price < 0:
            return _err("price_per_kwh cannot be negative", 400)
        cfg["price_per_kwh"] = price

    if "currency" in body:
        cur = str(body["currency"]).strip()[:8]
        cfg["currency"] = cur or "$"

    if "tracked" in body:
        tracked = body["tracked"]
        if not isinstance(tracked, list):
            return _err("tracked must be a list of statistic ids", 400)
        seen = set()
        clean = []
        for s in tracked:
            s = str(s).strip()
            if s and s not in seen:
                seen.add(s)
                clean.append(s)
        cfg["tracked"] = clean

    if "labels" in body:
        labels = body["labels"]
        if not isinstance(labels, dict):
            return _err("labels must be an object", 400)
        cfg["labels"] = {str(k): str(v).strip()[:80]
                         for k, v in labels.items() if str(v).strip()}

    if "allow_dashboards" in body:
        cfg["allow_dashboards"] = bool(body["allow_dashboards"])

    await _save_config(cfg)
    _summary_cache.clear()   # tracked/price/labels changed — recompute summaries
    return web.json_response({"ok": True, "config": cfg})


# ---------------------------------------------------------------- API: report

async def api_report(request):
    X.require_admin(request)
    rng = request.query.get("range", "today")
    if rng not in RANGES:
        rng = "today"
    cfg = await _load_config()
    return web.json_response(await _build_report(cfg, rng))


async def _build_report(cfg, rng):
    """Compute the full report payload for one range. Shared by the admin
    /report endpoint and the read-only dashboard summary — all statistics
    math lives here, nowhere else."""
    base = {
        "connected": X.HA.connected,
        "range": rng,
        "period": "hour" if rng in ("today", "yesterday") else "day",
        "price_per_kwh": cfg["price_per_kwh"],
        "currency": cfg["currency"],
        "buckets": [],
        "total_series": [],
        "sensors": [],
        "totals": {"kwh": 0.0, "cost": 0.0, "avg_per_day": None, "days": 0},
        "top": None,
        "message": "",
    }

    if not cfg["tracked"]:
        base["message"] = ("No sensors are tracked yet — open Setup and pick "
                           "your energy sensors.")
        return base
    if not X.HA.connected:
        base["message"] = ("Not connected to Home Assistant yet — "
                           "try again in a few seconds.")
        return base

    tz = await _local_tz()
    now_local = datetime.now(tz)
    start_local, end_local, period = _range_bounds(rng, now_local)
    base["period"] = period

    msg = {"type": "recorder/statistics_during_period",
           "start_time": start_local.astimezone(timezone.utc).isoformat(),
           "statistic_ids": list(cfg["tracked"]),
           "period": period,
           "types": ["change"]}
    if end_local is not None:
        msg["end_time"] = end_local.astimezone(timezone.utc).isoformat()

    try:
        stats = await X.HA.ws_call(msg)
    except Exception as exc:
        base["message"] = ("Could not read long-term statistics from the "
                           f"recorder ({exc}). The recorder may still be "
                           "starting up — try again in a minute.")
        return base

    stats = stats or {}
    units = await _units_for(cfg["tracked"])
    meta_names = {}
    try:
        metas = await X.HA.ws_call({"type": "recorder/get_statistics_metadata",
                                    "statistic_ids": list(cfg["tracked"])})
        for m in metas or []:
            meta_names[m.get("statistic_id")] = m.get("name")
    except Exception:
        pass

    # Buckets = sorted union of the bucket starts the recorder returned.
    # This sidesteps every UTC/local/half-hour-offset alignment headache.
    bucket_set = set()
    per_sensor = {}                      # sid -> {ts_ms: kwh}
    for sid in cfg["tracked"]:
        unit = units.get(sid, "kWh")
        rowmap = {}
        for row in stats.get(sid) or []:
            ts = _ts_ms(row.get("start"))
            ch = row.get("change")
            if ts is None or ch is None:
                continue
            rowmap[ts] = rowmap.get(ts, 0.0) + _to_kwh(ch, unit)
            bucket_set.add(ts)
        per_sensor[sid] = rowmap
    buckets = sorted(bucket_set)
    base["buckets"] = buckets

    price = cfg["price_per_kwh"]
    grand = 0.0
    total_series = [0.0] * len(buckets)
    sensors = []
    for sid in cfg["tracked"]:
        rowmap = per_sensor.get(sid, {})
        series = []
        total = 0.0
        for i, ts in enumerate(buckets):
            v = max(0.0, rowmap.get(ts, 0.0))   # negative change = meter reset
            v = round(v, 6)
            series.append(v)
            total_series[i] += v
            total += v
        total = round(total, 6)
        grand += total
        sensors.append({
            "id": sid,
            "name": _friendly(sid, cfg, meta_names.get(sid)),
            "unit": units.get(sid, "kWh"),
            "total_kwh": total,
            "cost": round(total * price, 4),
            "series": series,
        })

    grand = round(grand, 6)
    for s in sensors:
        s["share"] = round(100.0 * s["total_kwh"] / grand, 1) if grand > 0 else 0.0
    sensors.sort(key=lambda s: -s["total_kwh"])

    if rng == "yesterday":
        days = 1
    else:
        days = (now_local.date() - start_local.date()).days + 1
    base["sensors"] = sensors
    base["total_series"] = [round(v, 6) for v in total_series]
    base["totals"] = {
        "kwh": grand,
        "cost": round(grand * price, 4),
        "avg_per_day": round(grand / days, 6) if rng in ("week", "month") else None,
        "days": days,
    }
    if sensors and sensors[0]["total_kwh"] > 0:
        top = sensors[0]
        base["top"] = {"id": top["id"], "name": top["name"],
                       "kwh": top["total_kwh"], "cost": top["cost"],
                       "share": top["share"]}
    if not buckets:
        base["message"] = ("No statistics found in this range yet. Long-term "
                           "statistics are written once an hour — a brand-new "
                           "sensor needs about an hour before data appears.")
    return base


# ---------------------------------------------------------------- API: dashboard summary

def _dash_auth(request, slug):
    """Dashboard-session auth: any logged-in user who can open the dashboard
    in ?d=<slug> may read the summary. Deliberately NOT admin-gated."""
    name = X.request_user(request)
    if not name:
        raise web.HTTPUnauthorized(text="not logged in")
    if not X.STORE.can_access(name, slug):
        raise web.HTTPForbidden(text="no access to this dashboard")
    return name


async def api_dash_summary(request):
    """Read-only energy summary for dashboard widgets (wall tablets).

    GET /api/dash/energy_center/summary?d=<slug>&range=today|yesterday|week|month
    Cached per range for SUMMARY_TTL seconds — dashboards poll, and the
    recorder should not be hit more than once per range per 2 minutes.
    """
    _dash_auth(request, request.query.get("d", ""))

    rng = request.query.get("range", "today")
    if rng not in RANGES:
        rng = "today"

    cfg = await _load_config()
    if not cfg.get("allow_dashboards", True):
        raise web.HTTPForbidden(
            text="dashboard access to Energy Center is disabled")
    if not cfg["tracked"]:
        return web.json_response({"unconfigured": True})

    now = time.monotonic()
    hit = _summary_cache.get(rng)
    if hit and hit[0] > now:
        return web.json_response(hit[1])

    report = await _build_report(cfg, rng)
    tz = await _local_tz()

    # Series: hourly buckets for today/yesterday, daily for week/month.
    # Capped at the last 31 points (a full month of daily buckets).
    period = report.get("period", "hour")
    series = []
    for ts, v in zip(report.get("buckets") or [],
                     report.get("total_series") or []):
        dt = datetime.fromtimestamp(ts / 1000.0, tz)
        label = (dt.strftime("%H:00") if period == "hour"
                 else f"{dt.strftime('%b')} {dt.day}")
        series.append({"label": label, "kwh": round(float(v), 6)})
    series = series[-31:]

    top = [{"name": s["name"], "kwh": s["total_kwh"], "cost": s["cost"],
            "pct": s.get("share", 0.0)}
           for s in report.get("sensors") or [] if s["total_kwh"] > 0][:5]

    totals = report.get("totals") or {}
    payload = {
        "range": rng,
        "total_kwh": float(totals.get("kwh") or 0.0),
        "total_cost": float(totals.get("cost") or 0.0),
        "currency": cfg["currency"],
        "top": top,
        "series": series,
        "updated": datetime.now(timezone.utc).isoformat(),
    }
    # Only cache real data — an empty payload from a still-starting recorder
    # should not stick around for two minutes.
    if report.get("connected"):
        _summary_cache[rng] = (now + SUMMARY_TTL, payload)
    return web.json_response(payload)


# ---------------------------------------------------------------- register

def register(app, ctx, manifest):
    global X
    X = ctx
    base = "/api/tools/energy_center"
    app.router.add_get("/tools/energy_center/", page_tool)

    app.router.add_get(f"{base}/sensors", api_sensors)
    app.router.add_get(f"{base}/config", api_config_get)
    app.router.add_post(f"{base}/config", api_config_post)
    app.router.add_get(f"{base}/report", api_report)

    # read-only summary for dashboard widgets (dashboard-session auth,
    # NOT admin-gated — see _dash_auth)
    app.router.add_get("/api/dash/energy_center/summary", api_dash_summary)
