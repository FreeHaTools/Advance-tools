"""History Explorer — Advance Tools plugin.

Pick entities and a time range, and actually understand what happened: line
charts for numeric sensors, state timelines for discrete entities, real
statistics (min / max / mean / median / delta / on-time / transitions) and a
CSV export.

Everything comes out of Home Assistant's recorder, through two very different
doors:

  * raw history  — the REST endpoint /api/history/period, proxied through the
                   Supervisor. Every single state change, full resolution.
                   Great for hours, ruinous for months.
  * statistics   — the recorder/statistics_during_period WebSocket API, i.e.
                   pre-aggregated 5-minute / hourly / daily buckets that
                   survive recorder purges. Great for months, useless for
                   "what happened at 14:03".

The tool picks the door for you (see _pick_source) and always tells the UI
which one it used, so the chart can be honest about its own resolution.

Endpoints (all admin-gated):

  GET /                 the tool page
  GET /entities         chartable entities, split numeric / discrete
  GET /history          series + computed stats for a range
  GET /csv              the same data as a downloadable CSV
"""
import asyncio
import csv
import io
import statistics as pystats
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import quote

import aiohttp
from aiohttp import web

X = None  # core context, injected by the loader
TOOL_DIR = Path(__file__).parent

# ---------------------------------------------------------------- tuning

MAX_ENTITIES = 6            # series per request (the UI enforces the same cap)
MAX_POINTS = 1500           # points per numeric series after down-sampling
MAX_SEGMENTS = 2000         # state-timeline segments per discrete entity
RAW_MAX_HOURS = 48          # longer than this and "auto" switches to statistics
ENTITIES_TTL = 30           # seconds the /entities list is cached
HTTP_TIMEOUT = 45           # seconds for the raw-history REST call

# States that mean "there is no reading", never plotted, never counted.
NULL_STATES = {"unavailable", "unknown", "none", "null", ""}

# Domains whose state is a value on a scale — charted as lines.
NUMERIC_DOMAINS = {"sensor", "number", "input_number", "counter"}

# Domains whose state is a word — charted as a coloured timeline band.
DISCRETE_DOMAINS = {
    "binary_sensor", "switch", "light", "lock", "climate", "person",
    "device_tracker", "input_boolean", "fan", "cover", "media_player",
    "alarm_control_panel", "automation", "script", "sun", "vacuum",
    "water_heater", "humidifier", "siren", "remote", "input_select",
    "select", "timer", "schedule", "update", "group",
}

# Discrete states counted towards "on-time".
ON_STATES = {
    "on", "open", "opening", "home", "unlocked", "unlocking", "playing",
    "detected", "active", "above_horizon", "cleaning", "returning",
    "running", "armed_home", "armed_away", "armed_night", "armed_vacation",
    "armed_custom_bypass", "arming", "pending", "triggered", "heat", "cool",
    "heat_cool", "auto", "dry", "fan_only", "wet", "moist", "unsafe",
}

# Discrete states counted towards "off-time". Anything in neither set is
# reported in state_durations but left out of the on/off split, because
# guessing is worse than saying nothing.
OFF_STATES = {
    "off", "closed", "closing", "not_home", "away", "locked", "locking",
    "idle", "paused", "standby", "clear", "below_horizon", "docked",
    "disarmed", "not_detected", "dry_ok", "safe", "normal",
}

BUCKETS = ("auto", "raw", "5m", "1h", "1d")
_PERIOD_FOR = {"5m": "5minute", "1h": "hour", "1d": "day"}
_PERIOD_MS = {"5minute": 5 * 60_000, "hour": 3_600_000, "day": 86_400_000}

_tz_cache = None
_entities_cache = None       # (expires_monotonic, payload)
_entities_lock = asyncio.Lock()


def _err(msg, status=400):
    return web.json_response({"error": str(msg)}, status=status)


# ---------------------------------------------------------------- time helpers

async def _local_tz():
    """Home Assistant's configured time zone (cached).

    Day boundaries must land where the user thinks midnight is, not where UTC
    thinks it is — "Today" in Tehran is not "Today" in UTC.
    """
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
        X.log.debug("history_explorer: get_config failed — using local tz")
    return datetime.now().astimezone().tzinfo  # not cached, retried next call


def _parse_iso(value, tz):
    """Parse an ISO-8601 timestamp. Naive input is read in HA's time zone."""
    if not value:
        return None
    s = str(value).strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    return dt.replace(tzinfo=tz) if dt.tzinfo is None else dt


def _iso_z(dt):
    """UTC ISO-8601 with a Z suffix — what HA's history endpoint expects."""
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _ms(dt):
    return int(dt.timestamp() * 1000)


def _stat_ts(value):
    """A statistics bucket 'start' → epoch ms (HA sends ms, older sent ISO)."""
    if isinstance(value, (int, float)):
        return int(value)
    try:
        return int(datetime.fromisoformat(
            str(value).replace("Z", "+00:00")).timestamp() * 1000)
    except Exception:
        return None


# ---------------------------------------------------------------- entity model

def _domain(entity_id):
    return str(entity_id).split(".", 1)[0]


def _is_numeric_state(state, attrs):
    if str(state).lower() in NULL_STATES:
        # No reading right now, but a unit still means it is a numeric sensor.
        return bool((attrs or {}).get("unit_of_measurement"))
    try:
        float(state)
    except (TypeError, ValueError):
        return False
    return True


def _classify(entity_id, st):
    """'numeric', 'discrete' or None (not worth charting)."""
    dom = _domain(entity_id)
    attrs = (st or {}).get("attributes") or {}
    state = (st or {}).get("state")
    if dom in NUMERIC_DOMAINS and _is_numeric_state(state, attrs):
        return "numeric"
    if dom in DISCRETE_DOMAINS:
        return "discrete"
    # A climate/humidifier-style entity may also carry numeric attributes, but
    # attribute history is out of scope — the state is the story here.
    if dom not in NUMERIC_DOMAINS and _is_numeric_state(state, attrs) \
            and attrs.get("unit_of_measurement"):
        return "numeric"
    return None


async def _area_map():
    """entity_id -> area name, from the entity/device/area registries."""
    try:
        ents = await X.HA.ws_call({"type": "config/entity_registry/list"}) or []
        devs = await X.HA.ws_call({"type": "config/device_registry/list"}) or []
        areas = await X.HA.ws_call({"type": "config/area_registry/list"}) or []
    except Exception:
        X.log.debug("history_explorer: registries unavailable — no area names")
        return {}
    names = {a.get("area_id"): (a.get("name") or a.get("area_id"))
             for a in areas if a.get("area_id")}
    dev_area = {d.get("id"): d.get("area_id") for d in devs if d.get("id")}
    out = {}
    for e in ents:
        eid = e.get("entity_id")
        if not eid:
            continue
        aid = e.get("area_id") or dev_area.get(e.get("device_id"))
        if aid and names.get(aid):
            out[eid] = names[aid]
    return out


# ---------------------------------------------------------------- data sources

async def _rest_history(entity_ids, start, end):
    """Raw state history from HA Core, proxied through the Supervisor.

    Returns HA's native shape: a list of per-entity lists of state objects.
    Tests replace this function wholesale to fake Home Assistant.
    """
    if not X.SUPERVISOR_TOKEN:
        return []
    url = ("http://supervisor/core/api/history/period/" + quote(_iso_z(start))
           + "?filter_entity_id=" + quote(",".join(entity_ids))
           + "&end_time=" + quote(_iso_z(end))
           + "&minimal_response")
    headers = {"Authorization": f"Bearer {X.SUPERVISOR_TOKEN}"}
    async with aiohttp.ClientSession() as s:
        async with s.get(url, headers=headers,
                         timeout=aiohttp.ClientTimeout(total=HTTP_TIMEOUT)) as r:
            if r.status != 200:
                raise RuntimeError(
                    f"history endpoint returned HTTP {r.status}")
            return await r.json()


async def _stats_ids(entity_ids):
    """Which of these entities the recorder actually keeps statistics for."""
    try:
        metas = await X.HA.ws_call({"type": "recorder/list_statistic_ids"}) or []
    except Exception:
        X.log.debug("history_explorer: list_statistic_ids failed")
        return set()
    wanted = set(entity_ids)
    return {m.get("statistic_id") for m in metas
            if m.get("statistic_id") in wanted}


async def _fetch_stats(entity_ids, start, end, period):
    try:
        return await X.HA.ws_call({
            "type": "recorder/statistics_during_period",
            "start_time": start.astimezone(timezone.utc).isoformat(),
            "end_time": end.astimezone(timezone.utc).isoformat(),
            "statistic_ids": list(entity_ids),
            "period": period,
            "types": ["mean", "min", "max"],
        }) or {}
    except Exception as exc:
        raise RuntimeError(f"recorder statistics unavailable: {exc}")


def _pick_source(span_hours, bucket):
    """Decide raw-vs-statistics for numeric series.

    'raw' and an explicit bucket size are honoured as asked. 'auto' uses raw
    history up to RAW_MAX_HOURS (48h) — long enough for "yesterday evening",
    short enough that the recorder is not asked for a million rows — then
    hourly buckets up to 60 days, then daily.
    """
    if bucket == "raw":
        return "history", None
    if bucket in _PERIOD_FOR:
        return "statistics", _PERIOD_FOR[bucket]
    if span_hours <= RAW_MAX_HOURS:
        return "history", None
    if span_hours <= 24 * 60:
        return "statistics", "hour"
    return "statistics", "day"


# ---------------------------------------------------------------- series build

def _numeric_from_history(entries, start_ms, end_ms):
    """Raw state objects → [[ts, value|None], …].

    A None is a deliberate break in the line: the entity was unavailable or
    unknown. Plotting those as 0 invents a reading that never existed, which
    is how a thermostat ends up looking like it hit absolute zero at 3 a.m.
    """
    points = []
    for item in entries:
        ts = _entry_ts(item)
        if ts is None or ts > end_ms:
            continue
        raw = str(item.get("state", "")).lower()
        if raw in NULL_STATES:
            if points and points[-1][1] is not None:
                points.append([ts, None])
            continue
        try:
            val = float(item.get("state"))
        except (TypeError, ValueError):
            continue
        points.append([ts, val])
    # A leading gap marker carries no information — drop it.
    while points and points[0][1] is None:
        points.pop(0)
    while points and points[-1][1] is None:
        points.pop()
    return points


def _entry_ts(item):
    dt = item.get("last_changed") or item.get("last_updated")
    if isinstance(dt, (int, float)):
        return int(dt)
    try:
        return int(datetime.fromisoformat(
            str(dt).replace("Z", "+00:00")).timestamp() * 1000)
    except Exception:
        return None


def _numeric_from_stats(rows, period):
    """Statistics buckets → [[ts, mean|None], …], gaps preserved.

    Two buckets further apart than 1.5 periods means the recorder had nothing
    to summarise in between — that is a real gap, so break the line there.
    """
    step = _PERIOD_MS.get(period, 3_600_000)
    clean = []
    for row in rows or []:
        ts = _stat_ts(row.get("start"))
        if ts is None:
            continue
        val = row.get("mean")
        if val is None:
            val = row.get("max") if row.get("min") is None else row.get("min")
        if val is None:
            continue
        try:
            clean.append([ts, float(val)])
        except (TypeError, ValueError):
            continue
    clean.sort(key=lambda p: p[0])
    points = []
    prev = None
    for ts, val in clean:
        if prev is not None and ts - prev > step * 1.5:
            points.append([prev + step, None])
        points.append([ts, val])
        prev = ts
    return points


def _downsample(points, limit=MAX_POINTS):
    """Thin a numeric series without ever closing a gap.

    The series is cut into runs of real values at its None markers, each run
    gets a share of the budget proportional to its length, and is decimated by
    a fixed stride with its first and last point always kept. Endpoints and
    gaps therefore survive, which is exactly what the eye reads a chart for.
    """
    real = sum(1 for p in points if p[1] is not None)
    if real <= limit:
        return points, False

    runs, cur = [], []
    for p in points:
        if p[1] is None:
            if cur:
                runs.append(cur)
                cur = []
            runs.append(p)             # the gap marker, kept verbatim
        else:
            cur.append(p)
    if cur:
        runs.append(cur)

    out = []
    for run in runs:
        if not isinstance(run[0], list):
            out.append(run)            # a [ts, None] gap marker, not a run
            continue
        budget = max(2, int(limit * len(run) / real))
        if len(run) <= budget:
            out.extend(run)
            continue
        stride = len(run) / float(budget)
        picked = [run[min(len(run) - 1, int(i * stride))] for i in range(budget)]
        if picked[-1] is not run[-1]:
            picked.append(run[-1])
        out.extend(picked)
    return out, True


def _segments_from_history(entries, start_ms, end_ms):
    """Raw state objects → [[start, end, state], …] for the state timeline."""
    changes = []
    for item in entries:
        ts = _entry_ts(item)
        if ts is None or ts > end_ms:
            continue
        state = str(item.get("state", ""))
        ts = max(ts, start_ms)
        if changes and changes[-1][1] == state:
            continue                    # HA repeats the state on attr changes
        changes.append([ts, state])
    segments = []
    for i, (ts, state) in enumerate(changes):
        stop = changes[i + 1][0] if i + 1 < len(changes) else end_ms
        if stop > ts:
            segments.append([ts, stop, state])
    return segments


# ---------------------------------------------------------------- statistics

def _numeric_stats(points, end_ms):
    """min / max / mean / median / first / last / delta for a numeric series.

    The mean is *time-weighted*: HA states are step functions held until the
    next report, so a value that stood for six hours must not count the same
    as one that stood for six seconds. Sampling rates are irregular and gaps
    are common, and a plain average of samples quietly lies about both.
    """
    numbers = [v for _, v in points if v is not None]
    if not numbers:
        return None
    weighted, duration = 0.0, 0.0
    for i, (ts, val) in enumerate(points):
        if val is None:
            continue        # the gap marker itself carries no weight
        # The step ends at the next point of any kind, so a None correctly
        # cuts the step short at the moment the entity went unavailable.
        stop = points[i + 1][0] if i + 1 < len(points) else end_ms
        dt = max(0.0, stop - ts)
        weighted += val * dt
        duration += dt
    mean = (weighted / duration) if duration > 0 else (sum(numbers) / len(numbers))
    return {
        "count": len(numbers),
        "min": round(min(numbers), 4),
        "max": round(max(numbers), 4),
        "mean": round(mean, 4),
        "median": round(pystats.median(numbers), 4),
        "first": round(numbers[0], 4),
        "last": round(numbers[-1], 4),
        "delta": round(numbers[-1] - numbers[0], 4),
        "mean_method": "time_weighted",
    }


def _discrete_stats(segments):
    """on-time / off-time / transitions / per-state durations, in seconds."""
    if not segments:
        return None
    durations = {}
    on_s = off_s = null_s = 0.0
    for start, stop, state in segments:
        secs = max(0.0, (stop - start) / 1000.0)
        key = str(state)
        durations[key] = durations.get(key, 0.0) + secs
        low = key.lower()
        if low in NULL_STATES:
            null_s += secs
        elif low in ON_STATES:
            on_s += secs
        elif low in OFF_STATES:
            off_s += secs
    # Transitions = the number of times the state actually changed, so a
    # two-segment day is one transition, not two.
    return {
        "on_seconds": round(on_s, 1),
        "off_seconds": round(off_s, 1),
        "unavailable_seconds": round(null_s, 1),
        "transitions": max(0, len(segments) - 1),
        "first": str(segments[0][2]),
        "last": str(segments[-1][2]),
        "durations": {k: round(v, 1) for k, v in durations.items()},
    }


# ---------------------------------------------------------------- core query

async def _collect(request):
    """Shared engine behind /history and /csv. Returns the response payload."""
    tz = await _local_tz()
    now = datetime.now(tz)

    raw_ids = [e.strip() for e in
               (request.query.get("entities") or "").split(",") if e.strip()]
    seen, entity_ids = set(), []
    for eid in raw_ids:
        if eid not in seen:
            seen.add(eid)
            entity_ids.append(eid)
    if not entity_ids:
        raise web.HTTPBadRequest(text="no entities requested")
    if len(entity_ids) > MAX_ENTITIES:
        raise web.HTTPBadRequest(
            text=f"at most {MAX_ENTITIES} entities can be charted at once")

    end = _parse_iso(request.query.get("end"), tz) or now
    start = _parse_iso(request.query.get("start"), tz) or (end - timedelta(hours=24))
    if start >= end:
        raise web.HTTPBadRequest(text="start must be before end")
    end = min(end, now)                    # the future has no history
    if start >= end:
        start = end - timedelta(hours=1)

    bucket = request.query.get("bucket", "auto")
    if bucket not in BUCKETS:
        bucket = "auto"

    start_ms, end_ms = _ms(start), _ms(end)
    span_hours = (end - start).total_seconds() / 3600.0

    kinds = {}
    for eid in entity_ids:
        st = X.HA.states.get(eid) if X.HA else None
        kinds[eid] = _classify(eid, st) or (
            "numeric" if _domain(eid) in NUMERIC_DOMAINS else "discrete")

    numeric_ids = [e for e in entity_ids if kinds[e] == "numeric"]
    discrete_ids = [e for e in entity_ids if kinds[e] == "discrete"]

    source, period = _pick_source(span_hours, bucket)

    # Discrete entities have no statistics — a light switch has no hourly
    # mean. They always come from raw history, whatever the numeric side does.
    stats_ok = set()
    if source == "statistics" and numeric_ids:
        stats_ok = await _stats_ids(numeric_ids)
    history_ids = discrete_ids + [e for e in numeric_ids if e not in stats_ok]

    hist_raw = {}
    if history_ids:
        try:
            data = await _rest_history(history_ids, start, end)
        except Exception as exc:
            raise web.HTTPBadGateway(text=f"could not read history: {exc}")
        for block in data or []:
            if not block:
                continue
            eid = block[0].get("entity_id")
            if not eid:
                # minimal_response omits entity_id after the first entry, but
                # never on the first one — fall back to request order.
                continue
            hist_raw[eid] = block

    stats_raw = {}
    if stats_ok:
        try:
            stats_raw = await _fetch_stats(sorted(stats_ok), start, end, period)
        except Exception as exc:
            raise web.HTTPBadGateway(text=str(exc))

    series, warnings = [], []
    for eid in entity_ids:
        st = X.HA.states.get(eid) if X.HA else None
        attrs = (st or {}).get("attributes") or {}
        item = {
            "entity_id": eid,
            "name": attrs.get("friendly_name") or eid,
            "unit": attrs.get("unit_of_measurement") or "",
            "device_class": attrs.get("device_class") or "",
            "kind": kinds[eid],
            "downsampled": False,
        }
        if kinds[eid] == "numeric":
            if eid in stats_ok:
                item["source"] = "statistics"
                item["period"] = period
                pts = _numeric_from_stats(stats_raw.get(eid), period)
            else:
                item["source"] = "history"
                item["period"] = None
                pts = _numeric_from_history(
                    hist_raw.get(eid) or [], start_ms, end_ms)
                if source == "statistics" and numeric_ids:
                    warnings.append(
                        f"{item['name']} has no long-term statistics, so it is "
                        "drawn from raw history at full resolution.")
            raw_count = sum(1 for p in pts if p[1] is not None)
            pts, cut = _downsample(pts)
            item["points"] = pts
            item["raw_points"] = raw_count
            item["downsampled"] = cut
            item["stats"] = _numeric_stats(pts, end_ms)
        else:
            item["source"] = "history"
            item["period"] = None
            segs = _segments_from_history(
                hist_raw.get(eid) or [], start_ms, end_ms)
            item["raw_points"] = len(segs)
            if len(segs) > MAX_SEGMENTS:
                segs = segs[:MAX_SEGMENTS]
                item["downsampled"] = True
            item["segments"] = segs
            item["stats"] = _discrete_stats(segs)
        if not item.get("points") and not item.get("segments"):
            item["empty_reason"] = (
                "No recorder history for this entity in this range — it may be "
                "excluded in your recorder settings, or it may not have existed "
                "yet.")
        series.append(item)

    used = sorted({s["source"] for s in series})
    return {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "timezone": str(getattr(tz, "key", "") or now.tzname() or "UTC"),
        "span_hours": round(span_hours, 3),
        "bucket": bucket,
        "source": used[0] if len(used) == 1 else "mixed",
        "period": period,
        "resolution": _resolution_text(used, period),
        "max_points": MAX_POINTS,
        "series": series,
        "warnings": warnings,
    }


def _resolution_text(used, period):
    if used == ["history"]:
        return ("Full resolution — every recorded state change, straight from "
                "the recorder.")
    label = {"5minute": "5-minute", "hour": "hourly", "day": "daily"}.get(
        period, "aggregated")
    if used == ["statistics"]:
        return (f"Long-term statistics — {label} averages. Short spikes between "
                "buckets are averaged away.")
    return (f"Mixed — some series are full-resolution history, others are "
            f"{label} statistics.")


# ---------------------------------------------------------------- endpoints

async def page_tool(request):
    if not X.is_admin(request):
        raise web.HTTPFound("/?d=__admin__")
    return web.FileResponse(TOOL_DIR / "static" / "index.html")


async def api_entities(request):
    """Every entity worth charting, split into numeric and discrete."""
    X.require_admin(request)
    global _entities_cache
    async with _entities_lock:
        now = time.monotonic()
        if _entities_cache and _entities_cache[0] > now:
            return web.json_response(_entities_cache[1])

        if not X.HA or not X.HA.connected:
            return web.json_response({
                "connected": False, "numeric": [], "discrete": [],
                "message": "Not connected to Home Assistant yet — "
                           "try again in a few seconds."})

        areas = await _area_map()
        numeric, discrete = [], []
        for eid, st in (X.HA.states or {}).items():
            kind = _classify(eid, st)
            if not kind:
                continue
            attrs = st.get("attributes") or {}
            row = {
                "entity_id": eid,
                "name": attrs.get("friendly_name") or eid,
                "unit": attrs.get("unit_of_measurement") or "",
                "device_class": attrs.get("device_class") or "",
                "area": areas.get(eid) or "",
                "domain": _domain(eid),
                "state": st.get("state"),
            }
            (numeric if kind == "numeric" else discrete).append(row)

        key = lambda r: (str(r["name"]).lower(), r["entity_id"])  # noqa: E731
        numeric.sort(key=key)
        discrete.sort(key=key)
        payload = {"connected": True, "numeric": numeric, "discrete": discrete,
                   "max_entities": MAX_ENTITIES}
        _entities_cache = (now + ENTITIES_TTL, payload)
        return web.json_response(payload)


async def api_history(request):
    X.require_admin(request)
    return web.json_response(await _collect(request))


async def api_csv(request):
    """The same data as a CSV: one row per timestamp, one column per entity."""
    X.require_admin(request)
    payload = await _collect(request)
    tz = await _local_tz()

    # Union of every timestamp any series reported at. Blank cells are honest:
    # that entity simply had nothing to say at that instant.
    columns, values, stamps = [], [], set()
    for s in payload["series"]:
        columns.append(s)
        cell = {}
        if s["kind"] == "numeric":
            for ts, val in s.get("points") or []:
                if val is not None:
                    cell[ts] = val
                    stamps.add(ts)
        else:
            for start, _stop, state in s.get("segments") or []:
                cell[start] = state
                stamps.add(start)
        values.append(cell)

    buf = io.StringIO()
    out = csv.writer(buf, lineterminator="\n")
    out.writerow(["timestamp"] + [
        f"{c['entity_id']} ({c['unit']})" if c["unit"] else c["entity_id"]
        for c in columns])
    for ts in sorted(stamps):
        stamp = datetime.fromtimestamp(ts / 1000.0, tz).isoformat()
        out.writerow([stamp] + [cell.get(ts, "") for cell in values])

    name = "history_" + datetime.now(tz).strftime("%Y%m%d_%H%M") + ".csv"
    return web.Response(
        body=buf.getvalue().encode("utf-8-sig"),
        content_type="text/csv", charset="utf-8",
        headers={"Content-Disposition": f'attachment; filename="{name}"'})


# ---------------------------------------------------------------- register

def register(app, ctx, manifest):
    global X
    X = ctx
    base = "/api/tools/history_explorer"
    app.router.add_get("/tools/history_explorer/", page_tool)
    app.router.add_get(f"{base}/entities", api_entities)
    app.router.add_get(f"{base}/history", api_history)
    app.router.add_get(f"{base}/csv", api_csv)
