/* History Explorer — frontend logic.
 *
 * Talks to /api/tools/history_explorer/* (tool.py). Pure vanilla JS, no
 * libraries and no build step: the line chart is an SVG string assembled by
 * hand in buildChartSVG(), and the state timeline is plain positioned divs.
 *
 * buildChartSVG() and its helpers are deliberately pure — no DOM, no globals —
 * so they can be unit-tested outside a browser.
 */
"use strict";

const API = "/api/tools/history_explorer";
const MAX_SERIES = 6;
const COLORS = ["#3ecf8e", "#22b8cf", "#b17aff", "#ffb86b", "#ff6b81", "#ffd75c"];

const esc = (s) => String(s === null || s === undefined ? "" : s)
  .replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));

/* ================================================================== pure bits */

/** Round a range out to "nice" tick values (1/2/5 × 10^n). */
function niceTicks(lo, hi, want) {
  want = want || 5;
  if (!isFinite(lo) || !isFinite(hi)) return { lo: 0, hi: 1, ticks: [0, 1] };
  if (hi - lo < 1e-9) { lo -= 0.5; hi += 0.5; }
  const rawStep = (hi - lo) / want;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  const first = Math.floor(lo / step) * step;
  const last = Math.ceil(hi / step) * step;
  const ticks = [];
  for (let v = first; v <= last + step * 1e-6; v += step) {
    ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  }
  return { lo: first, hi: last, ticks };
}

/** Trim a number to something a human can read on an axis. */
function fmtVal(v, unit) {
  if (v === null || v === undefined || !isFinite(v)) return "–";
  const a = Math.abs(v);
  let s;
  if (a >= 10000) s = Math.round(v).toLocaleString();
  else if (a >= 100) s = v.toFixed(1);
  else if (a >= 1) s = v.toFixed(2);
  else if (a === 0) s = "0";
  else s = v.toFixed(3);
  s = s.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
  return unit ? s + " " + unit : s;
}

function fmtTime(ts, tz, mode) {
  const opt = { hour12: false };
  if (tz) opt.timeZone = tz;
  if (mode === "date") { opt.month = "short"; opt.day = "numeric"; }
  else if (mode === "full") {
    opt.month = "short"; opt.day = "numeric";
    opt.hour = "2-digit"; opt.minute = "2-digit";
  } else { opt.hour = "2-digit"; opt.minute = "2-digit"; }
  try {
    return new Intl.DateTimeFormat(undefined, opt).format(new Date(ts));
  } catch (e) {
    return new Date(ts).toISOString().slice(0, 16).replace("T", " ");
  }
}

function fmtDur(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d > 0) return d + "d " + (h % 24) + "h";
  if (h > 0) return h + "h " + (m % 60) + "m";
  return m + "m";
}

/**
 * Build the multi-series line chart as a standalone SVG string.
 *
 * series : [{entity_id, name, unit, color, points:[[ts, value|null], …]}]
 *          A null value is a real break in the line and is never bridged.
 * opt    : {width, height, t0, t1, tz}
 *
 * Returns {svg, plot:{x, y, w, h}, t0, t1, axes} — the geometry is handed back
 * so the hover crosshair can map pixels to timestamps without guessing.
 */
function buildChartSVG(series, opt) {
  opt = opt || {};
  const W = Math.max(300, Math.round(opt.width || 720));
  const H = Math.max(180, Math.round(opt.height || (W < 520 ? 230 : 300)));
  const tz = opt.tz || null;
  const narrow = W < 520;

  // Which units get an axis: the most-used unit goes left, the runner-up right.
  const counts = {};
  series.forEach((s) => { counts[s.unit || ""] = (counts[s.unit || ""] || 0) + 1; });
  const units = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  const leftUnit = units[0] || "";
  const rightUnit = units.length > 1 ? units[1] : null;
  const axisOf = (s) => ((rightUnit !== null && (s.unit || "") === rightUnit)
    ? "right" : "left");

  const padL = narrow ? 38 : 52;
  const padR = rightUnit !== null ? (narrow ? 38 : 52) : 12;
  const padT = 10;
  const padB = 26;
  const plot = { x: padL, y: padT, w: W - padL - padR, h: H - padT - padB };

  const t0 = opt.t0, t1 = opt.t1;
  const span = Math.max(1, t1 - t0);
  const xOf = (ts) => plot.x + plot.w * Math.min(1, Math.max(0, (ts - t0) / span));

  function domainFor(side) {
    let lo = Infinity, hi = -Infinity;
    series.forEach((s) => {
      if (axisOf(s) !== side) return;
      s.points.forEach((p) => {
        if (p[1] === null || p[1] === undefined) return;
        if (p[1] < lo) lo = p[1];
        if (p[1] > hi) hi = p[1];
      });
    });
    if (!isFinite(lo)) return null;
    // A dead-flat series still deserves to sit in the middle of the plot.
    if (hi - lo < 1e-9) { lo -= 1; hi += 1; }
    return niceTicks(lo, hi, narrow ? 4 : 5);
  }

  const left = domainFor("left");
  const right = rightUnit !== null ? domainFor("right") : null;
  const yOf = (v, side) => {
    const d = (side === "right" ? right : left) || { lo: 0, hi: 1 };
    const r = Math.max(1e-9, d.hi - d.lo);
    const y = plot.y + plot.h * (1 - (v - d.lo) / r);
    return Math.min(plot.y + plot.h, Math.max(plot.y, y));
  };

  const out = [];
  out.push('<svg viewBox="0 0 ' + W + " " + H + '" width="100%" height="' + H +
    '" xmlns="http://www.w3.org/2000/svg" role="img" ' +
    'aria-label="History chart">');

  // horizontal gridlines + left axis labels
  if (left) {
    left.ticks.forEach((tv) => {
      const y = yOf(tv, "left").toFixed(1);
      out.push('<line class="grid" x1="' + plot.x + '" y1="' + y + '" x2="' +
        (plot.x + plot.w) + '" y2="' + y + '"/>');
      out.push('<text class="alab" x="' + (plot.x - 6) + '" y="' + y +
        '" text-anchor="end" dominant-baseline="middle">' +
        esc(fmtVal(tv, "")) + "</text>");
    });
  }
  if (right) {
    right.ticks.forEach((tv) => {
      const y = yOf(tv, "right").toFixed(1);
      out.push('<text class="alab" x="' + (plot.x + plot.w + 6) + '" y="' + y +
        '" text-anchor="start" dominant-baseline="middle">' +
        esc(fmtVal(tv, "")) + "</text>");
    });
  }

  // x ticks
  const nTicks = narrow ? 3 : 5;
  const dayScale = span > 3 * 86400000;
  const xTicks = [];
  for (let i = 0; i <= nTicks; i++) {
    const ts = t0 + (span * i) / nTicks;
    xTicks.push(ts);
    const x = xOf(ts).toFixed(1);
    out.push('<line class="grid" x1="' + x + '" y1="' + plot.y + '" x2="' + x +
      '" y2="' + (plot.y + plot.h) + '"/>');
    const anchor = i === 0 ? "start" : (i === nTicks ? "end" : "middle");
    out.push('<text class="alab" x="' + x + '" y="' + (H - 8) +
      '" text-anchor="' + anchor + '">' +
      esc(fmtTime(ts, tz, dayScale ? "date" : "time")) + "</text>");
  }

  out.push('<line class="axis" x1="' + plot.x + '" y1="' + (plot.y + plot.h) +
    '" x2="' + (plot.x + plot.w) + '" y2="' + (plot.y + plot.h) + '"/>');
  out.push('<line class="axis" x1="' + plot.x + '" y1="' + plot.y +
    '" x2="' + plot.x + '" y2="' + (plot.y + plot.h) + '"/>');

  // the series themselves — a null value closes the current subpath
  series.forEach((s, i) => {
    const side = axisOf(s);
    let d = "", pen = false, drawn = 0;
    s.points.forEach((p) => {
      if (p[1] === null || p[1] === undefined) { pen = false; return; }
      const x = xOf(p[0]).toFixed(1), y = yOf(p[1], side).toFixed(1);
      d += (pen ? "L" : "M") + x + " " + y + " ";
      pen = true; drawn++;
    });
    if (!d) return;
    const color = s.color || COLORS[i % COLORS.length];
    out.push('<path class="sline" d="' + d.trim() + '" stroke="' + esc(color) +
      '" data-eid="' + esc(s.entity_id) + '"/>');
    // A single lonely sample draws no line at all — give it a dot.
    if (drawn === 1) {
      const p = s.points.find((q) => q[1] !== null && q[1] !== undefined);
      out.push('<circle cx="' + xOf(p[0]).toFixed(1) + '" cy="' +
        yOf(p[1], side).toFixed(1) + '" r="3" fill="' + esc(color) + '"/>');
    }
  });

  out.push("</svg>");
  return {
    svg: out.join(""),
    plot: plot, width: W, height: H, t0: t0, t1: t1,
    axes: { left: left, right: right, leftUnit: leftUnit, rightUnit: rightUnit }
  };
}

/** Stable colour for a discrete state name. */
function stateColor(state) {
  const s = String(state || "").toLowerCase();
  const known = {
    on: "#3ecf8e", open: "#3ecf8e", home: "#3ecf8e", playing: "#3ecf8e",
    unlocked: "#ffb86b", detected: "#ff6b81", triggered: "#ff6b81",
    off: "#39445e", closed: "#39445e", not_home: "#39445e", idle: "#39445e",
    locked: "#2f6b52", paused: "#8b98b8", standby: "#8b98b8",
    unavailable: "#5a2230", unknown: "#463a55", "": "#39445e"
  };
  if (known[s] !== undefined) return known[s];
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return "hsl(" + h + ",52%,52%)";
}

/* ================================================================== app */

function bootstrap() {
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));

  let ENTS = { numeric: [], discrete: [] };
  let SEL = [];                 // selected entity ids, in chart order
  let PICK = new Set();         // working selection inside the modal
  let DATA = null;              // last /history payload
  let CHART = null;             // geometry returned by buildChartSVG
  let HIDDEN = new Set();       // entity ids toggled off in the legend
  let TZ = null;                // Home Assistant's time zone
  let QUICK = "24h";
  let busy = false;
  let resizeTimer = null;

  /* ---------------------------------------------------------- helpers */

  function toast(msg, bad) {
    const t = document.createElement("div");
    t.className = "toast" + (bad ? " bad" : "");
    t.textContent = msg;
    $("#toasts").appendChild(t);
    setTimeout(() => t.remove(), bad ? 6500 : 3200);
  }

  async function api(path) {
    const r = await fetch(API + path);
    let data = {};
    try { data = await r.json(); } catch (e) { /* empty or non-JSON body */ }
    if (!r.ok) throw new Error(data.error || data.message || ("HTTP " + r.status));
    return data;
  }

  function notice(msg, bad) {
    const el = $("#notice");
    if (!msg) { el.style.display = "none"; return; }
    el.className = "notice" + (bad ? " bad" : "");
    el.innerHTML = msg;
    el.style.display = "block";
  }

  const colorOf = (eid) => COLORS[SEL.indexOf(eid) % COLORS.length];

  function metaOf(eid) {
    return ENTS.numeric.concat(ENTS.discrete)
      .find((e) => e.entity_id === eid) || { entity_id: eid, name: eid };
  }

  /* ---------------------------------------------------------- range */

  /** Wall-clock parts of an instant in Home Assistant's time zone. */
  function parts(ts) {
    const opt = {
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false
    };
    if (TZ) opt.timeZone = TZ;
    let f;
    try { f = new Intl.DateTimeFormat("en-CA", opt).formatToParts(new Date(ts)); }
    catch (e) { f = new Intl.DateTimeFormat("en-CA", { ...opt, timeZone: undefined })
      .formatToParts(new Date(ts)); }
    const o = {};
    f.forEach((p) => { if (p.type !== "literal") o[p.type] = p.value; });
    if (o.hour === "24") o.hour = "00";
    return o;
  }

  const naive = (p, h, m) =>
    p.year + "-" + p.month + "-" + p.day + "T" +
    (h !== undefined ? String(h).padStart(2, "0") : p.hour) + ":" +
    (m !== undefined ? String(m).padStart(2, "0") : p.minute) + ":00";

  /** {start, end} as ISO strings for the active range. */
  function range() {
    const from = $("#fromIn").value, to = $("#toIn").value;
    if (!QUICK && from && to) return { start: from + ":00", end: to + ":00" };
    const now = Date.now();
    const p = parts(now);
    const rolling = { hour: 3600e3, "24h": 86400e3, "7d": 7 * 86400e3,
      "30d": 30 * 86400e3 };
    if (rolling[QUICK]) {
      return { start: new Date(now - rolling[QUICK]).toISOString(),
        end: new Date(now).toISOString() };
    }
    if (QUICK === "today") {
      return { start: naive(p, 0, 0), end: new Date(now).toISOString() };
    }
    // "This month" — the 1st at midnight, in HA's time zone.
    return { start: p.year + "-" + p.month + "-01T00:00:00",
      end: new Date(now).toISOString() };
  }

  /** Mirror the active range into the custom from/to inputs. */
  function syncInputs(r) {
    const toLocal = (iso) => {
      const p = parts(new Date(iso).getTime());
      return p.year + "-" + p.month + "-" + p.day + "T" + p.hour + ":" + p.minute;
    };
    try {
      $("#fromIn").value = toLocal(r.start);
      $("#toIn").value = toLocal(r.end);
    } catch (e) { /* an unparseable custom value stays as the user typed it */ }
  }

  /* ---------------------------------------------------------- picker */

  function renderPickList() {
    const q = $("#pickSearch").value.trim().toLowerCase();
    const groups = {};
    const push = (e, kind) => {
      const hay = (e.entity_id + " " + e.name + " " + (e.area || "")).toLowerCase();
      if (q && hay.indexOf(q) < 0) return;
      const key = (e.area ? e.area + " · " : "") + e.domain;
      (groups[key] = groups[key] || []).push({ e: e, kind: kind });
    };
    ENTS.numeric.forEach((e) => push(e, "numeric"));
    ENTS.discrete.forEach((e) => push(e, "discrete"));

    const keys = Object.keys(groups).sort();
    if (!keys.length) {
      $("#pickList").innerHTML =
        '<div class="empty">No entity matches “' + esc($("#pickSearch").value) +
        "”.</div>";
      return;
    }
    let total = 0;
    const html = [];
    keys.forEach((k) => {
      const rows = groups[k].slice(0, 300);
      total += groups[k].length;
      html.push('<div class="pgroup">' + esc(k) + " · " + groups[k].length +
        "</div>");
      rows.forEach((r) => {
        const on = PICK.has(r.e.entity_id);
        const full = !on && PICK.size >= MAX_SERIES;
        html.push('<div class="prow' + (on ? " sel" : "") + (full ? " dim" : "") +
          '" data-eid="' + esc(r.e.entity_id) + '">' +
          '<div class="cb">' + (on ? "✓" : "") + "</div>" +
          '<div class="pn"><b>' + esc(r.e.name) + "</b>" +
          '<div class="pid">' + esc(r.e.entity_id) + "</div></div>" +
          '<span class="pbadge">' +
          esc(r.kind === "numeric" ? (r.e.unit || "number") : "state") +
          "</span></div>");
      });
      if (groups[k].length > rows.length) {
        html.push('<div class="pgroup">…' + (groups[k].length - rows.length) +
          " more — refine your search</div>");
      }
    });
    $("#pickList").innerHTML = html.join("");
    updateSelCount(total);
  }

  function updateSelCount() {
    const el = $("#selCount");
    el.textContent = PICK.size + " of " + MAX_SERIES + " selected";
    el.className = "selcount" + (PICK.size >= MAX_SERIES ? " over" : "");
  }

  function renderChips() {
    const html = SEL.map((eid) => {
      const m = metaOf(eid);
      return '<span class="chip"><span class="sw" style="background:' +
        esc(colorOf(eid)) + '"></span><span class="nm" title="' + esc(eid) +
        '">' + esc(m.name) + '</span><button class="x" data-drop="' + esc(eid) +
        '" title="Remove">✕</button></span>';
    });
    html.push('<span class="chip add" id="addChip">＋ Add entities</span>');
    $("#chips").innerHTML = html.join("");
    $("#pickSub").textContent = SEL.length
      ? SEL.length + " of " + MAX_SERIES + " series"
      : "nothing selected yet";
    $("#csvBtn").disabled = !SEL.length;
  }

  /* ---------------------------------------------------------- rendering */

  function visibleSeries() {
    if (!DATA) return [];
    return DATA.series.filter((s) => !HIDDEN.has(s.entity_id));
  }

  function renderChart() {
    const host = $("#chartHost");
    if (!DATA) {
      host.innerHTML = '<div class="empty"><span class="big">📈</span>' +
        "Pick one or more entities above, choose a range, and press " +
        "<b>Load</b>.</div>";
      $("#legend").innerHTML = "";
      CHART = null;
      return;
    }
    const numeric = visibleSeries().filter(
      (s) => s.kind === "numeric" && (s.points || []).some((p) => p[1] !== null));
    if (!numeric.length) {
      const anyNumeric = DATA.series.some((s) => s.kind === "numeric");
      host.innerHTML = '<div class="empty"><span class="big">' +
        (anyNumeric ? "🕳" : "🔀") + "</span>" + (anyNumeric
          ? "No numeric readings in this range.<br>The recorder has nothing " +
            "stored for these sensors here — they may be excluded in your " +
            "recorder settings, or the range may predate them."
          : "Only state entities are selected — see the <b>State timeline</b> " +
            "below.") + "</div>";
      $("#legend").innerHTML = "";
      CHART = null;
      renderLegend();
      return;
    }
    const w = Math.max(300, host.clientWidth || 720);
    CHART = buildChartSVG(numeric.map((s) => ({
      entity_id: s.entity_id, name: s.name, unit: s.unit,
      color: colorOf(s.entity_id), points: s.points || []
    })), {
      width: w,
      height: w < 520 ? 220 : 300,
      t0: new Date(DATA.start).getTime(),
      t1: new Date(DATA.end).getTime(),
      tz: TZ
    });
    host.innerHTML = CHART.svg;
    renderLegend();
  }

  function renderLegend() {
    if (!DATA) { $("#legend").innerHTML = ""; return; }
    $("#legend").innerHTML = DATA.series.map((s) => {
      const off = HIDDEN.has(s.entity_id);
      return '<span class="li' + (off ? " off" : "") + '" data-toggle="' +
        esc(s.entity_id) + '"><span class="sw" style="background:' +
        esc(colorOf(s.entity_id)) + '"></span><b>' + esc(s.name) + "</b>" +
        (s.unit ? " " + esc(s.unit) : "") + "</span>";
    }).join("");
  }

  function renderTimeline() {
    const disc = DATA ? DATA.series.filter((s) => s.kind === "discrete") : [];
    if (!disc.length) { $("#timelinePanel").style.display = "none"; return; }
    $("#timelinePanel").style.display = "";
    const t0 = new Date(DATA.start).getTime();
    const t1 = new Date(DATA.end).getTime();
    const span = Math.max(1, t1 - t0);
    const html = disc.map((s) => {
      const segs = s.segments || [];
      if (!segs.length) {
        return '<div class="tlrow"><div class="tlhead"><b>' + esc(s.name) +
          "</b></div><div class=\"empty\" style=\"padding:12px\">" +
          esc(s.empty_reason || "No history in this range.") + "</div></div>";
      }
      const seen = {};
      const bands = segs.map((g) => {
        const left = ((g[0] - t0) / span) * 100;
        const width = Math.max(0.15, ((g[1] - g[0]) / span) * 100);
        seen[g[2]] = true;
        return '<span class="tlseg" style="left:' + left.toFixed(3) +
          "%;width:" + width.toFixed(3) + "%;background:" +
          esc(stateColor(g[2])) + '" title="' + esc(g[2]) + " · " +
          esc(fmtTime(g[0], TZ, "full")) + '"></span>';
      }).join("");
      const key = Object.keys(seen).map((st) =>
        '<i><span class="sw" style="background:' + esc(stateColor(st)) +
        '"></span>' + esc(st) + "</i>").join("");
      const st = s.stats || {};
      return '<div class="tlrow"><div class="tlhead"><b>' + esc(s.name) +
        "</b><span>" + esc(fmtDur(st.on_seconds)) + " on · " +
        esc(String(st.transitions || 0)) + " changes</span></div>" +
        '<div class="tlbar">' + bands + "</div>" +
        '<div class="tlkey">' + key + "</div></div>";
    }).join("");
    $("#timeline").innerHTML = html +
      '<div class="tlaxis"><span>' + esc(fmtTime(t0, TZ, "full")) +
      "</span><span>" + esc(fmtTime(t1, TZ, "full")) + "</span></div>";
  }

  function renderStats() {
    if (!DATA || !DATA.series.length) {
      $("#statsPanel").style.display = "none";
      return;
    }
    $("#statsPanel").style.display = "";
    const head = "<thead><tr><th>Entity</th><th>Min</th><th>Max</th>" +
      "<th>Mean</th><th>Delta</th><th>On-time</th><th>Changes</th>" +
      "<th>Points</th></tr></thead>";
    const rows = DATA.series.map((s) => {
      const st = s.stats;
      const nm = '<td class="nm"><span class="sw" style="background:' +
        esc(colorOf(s.entity_id)) + '"></span>' + esc(s.name) +
        "<small>" + esc(s.entity_id) + "</small></td>";
      if (!st) {
        return "<tr>" + nm + '<td colspan="7" style="color:var(--mut)">' +
          esc(s.empty_reason || "No data in this range.") + "</td></tr>";
      }
      if (s.kind === "numeric") {
        const u = s.unit;
        const d = st.delta;
        const sign = d > 0 ? "+" : "";
        return "<tr>" + nm +
          '<td class="num">' + esc(fmtVal(st.min, u)) + "</td>" +
          '<td class="num">' + esc(fmtVal(st.max, u)) + "</td>" +
          '<td class="num">' + esc(fmtVal(st.mean, u)) + "</td>" +
          '<td class="num" style="color:' +
            (d > 0 ? "var(--good)" : d < 0 ? "var(--bad)" : "var(--mut)") + '">' +
            esc(sign + fmtVal(d, u)) + "</td>" +
          '<td class="num">–</td><td class="num">–</td>' +
          '<td class="num">' + esc(String(st.count)) +
          (s.downsampled ? " ⤓" : "") + "</td></tr>";
      }
      return "<tr>" + nm +
        '<td class="num">–</td><td class="num">–</td><td class="num">–</td>' +
        '<td class="num">' + esc(st.first + " → " + st.last) + "</td>" +
        '<td class="num">' + esc(fmtDur(st.on_seconds)) + "</td>" +
        '<td class="num">' + esc(String(st.transitions)) + "</td>" +
        '<td class="num">' + esc(String((s.segments || []).length)) + "</td></tr>";
    }).join("");
    $("#statsTable").innerHTML = head + "<tbody>" + rows + "</tbody>";
    $("#statsSub").textContent = "mean is time-weighted · ⤓ means the series " +
      "was down-sampled before sending";
  }

  function renderAll() {
    renderChart();
    renderTimeline();
    renderStats();
    if (!DATA) { $("#resText").textContent = ""; return; }
    const down = DATA.series.filter((s) => s.downsampled);
    $("#resText").innerHTML = "<b>" +
      esc(DATA.source === "statistics" ? "Long-term statistics"
        : DATA.source === "mixed" ? "Mixed sources" : "Raw history") +
      "</b> · " + esc(DATA.resolution) +
      (down.length ? " · " + down.length + " series down-sampled to ≤ " +
        DATA.max_points + " points" : "");
    const warn = (DATA.warnings || []).slice();
    const emptyOnes = DATA.series.filter((s) => s.empty_reason);
    if (emptyOnes.length) {
      warn.push(emptyOnes.length + " selected " +
        (emptyOnes.length === 1 ? "entity has" : "entities have") +
        " no recorder history in this range — they may be excluded in your " +
        "recorder settings, or they may not have existed yet.");
    }
    notice(warn.length ? warn.map(esc).join("<br>") : "");
  }

  /* ---------------------------------------------------------- hover */

  function onHover(ev) {
    const box = $("#hoverBox");
    if (!CHART) { box.style.display = "none"; return; }
    const svg = $("#chartHost svg");
    if (!svg) { box.style.display = "none"; return; }
    const rect = svg.getBoundingClientRect();
    const scale = rect.width / CHART.width || 1;
    const px = (ev.clientX - rect.left) / scale;
    if (px < CHART.plot.x - 4 || px > CHART.plot.x + CHART.plot.w + 4) {
      box.style.display = "none";
      const old = svg.querySelector(".cross");
      if (old) old.remove();
      return;
    }
    const frac = (px - CHART.plot.x) / CHART.plot.w;
    const ts = CHART.t0 + frac * (CHART.t1 - CHART.t0);

    let cross = svg.querySelector(".cross");
    if (!cross) {
      cross = document.createElementNS("http://www.w3.org/2000/svg", "line");
      cross.setAttribute("class", "cross");
      svg.appendChild(cross);
    }
    const cx = CHART.plot.x + CHART.plot.w * Math.min(1, Math.max(0, frac));
    cross.setAttribute("x1", cx); cross.setAttribute("x2", cx);
    cross.setAttribute("y1", CHART.plot.y);
    cross.setAttribute("y2", CHART.plot.y + CHART.plot.h);

    const lines = visibleSeries().filter((s) => s.kind === "numeric")
      .map((s) => {
        let best = null, bestD = Infinity;
        (s.points || []).forEach((p) => {
          if (p[1] === null) return;
          const d = Math.abs(p[0] - ts);
          if (d < bestD) { bestD = d; best = p; }
        });
        // Further than 4% of the range away means the line is broken here.
        const tol = (CHART.t1 - CHART.t0) * 0.04;
        const val = (best && bestD <= tol) ? fmtVal(best[1], s.unit) : "no data";
        return '<div class="hr"><span class="sw" style="background:' +
          esc(colorOf(s.entity_id)) + '"></span>' + esc(s.name) +
          '<span class="hv">' + esc(val) + "</span></div>";
      }).join("");
    if (!lines) { box.style.display = "none"; return; }

    box.innerHTML = '<div class="ht">' + esc(fmtTime(ts, TZ, "full")) +
      "</div>" + lines;
    box.style.display = "block";
    const wrap = $("#chartWrap").getBoundingClientRect();
    let bx = ev.clientX - wrap.left + 14;
    if (bx + box.offsetWidth > wrap.width) bx = ev.clientX - wrap.left - box.offsetWidth - 14;
    box.style.left = Math.max(0, bx) + "px";
    box.style.top = Math.max(0, ev.clientY - wrap.top - box.offsetHeight - 10) + "px";
  }

  /* ---------------------------------------------------------- loading */

  async function loadEntities() {
    try {
      const d = await api("/entities");
      if (!d.connected) {
        $("#pickList").innerHTML = '<div class="empty">' +
          esc(d.message || "Not connected to Home Assistant.") + "</div>";
        return;
      }
      ENTS = d;
      renderPickList();
      renderChips();
    } catch (e) {
      $("#pickList").innerHTML = '<div class="empty">Could not load entities: ' +
        esc(e.message) + "</div>";
    }
  }

  function queryString() {
    const r = range();
    return "?entities=" + encodeURIComponent(SEL.join(",")) +
      "&start=" + encodeURIComponent(r.start) +
      "&end=" + encodeURIComponent(r.end) +
      "&bucket=" + encodeURIComponent($("#bucketIn").value);
  }

  async function load() {
    if (busy) return;
    if (!SEL.length) {
      DATA = null; renderAll();
      notice("Pick at least one entity first.");
      return;
    }
    busy = true;
    $("#runBtn").disabled = true;
    $("#runBtn").textContent = "Loading…";
    notice("");
    try {
      const d = await api("/history" + queryString());
      DATA = d;
      TZ = d.timezone || TZ;
      HIDDEN = new Set([...HIDDEN].filter(
        (e) => d.series.some((s) => s.entity_id === e)));
      syncInputs(range());
      renderAll();
    } catch (e) {
      DATA = null;
      renderAll();
      notice("Could not load history: " + esc(e.message), true);
    } finally {
      busy = false;
      $("#runBtn").disabled = false;
      $("#runBtn").textContent = "Load";
    }
  }

  /* ---------------------------------------------------------- events */

  function setQuick(q) {
    QUICK = q;
    $$("#quick button").forEach((b) => b.classList.toggle("on", b.dataset.q === q));
    syncInputs(range());
    $("#rangeSub").textContent = {
      hour: "the last 60 minutes", today: "since midnight",
      "24h": "the last 24 hours", "7d": "the last 7 days",
      "30d": "the last 30 days", month: "since the 1st"
    }[q] || "custom range";
  }

  function openModal(id) { $(id).classList.add("open"); }
  function closeModal(id) { $(id).classList.remove("open"); }

  document.addEventListener("click", (ev) => {
    const t = ev.target;

    if (t.closest("[data-close]")) {
      const m = t.closest(".modal");
      if (m) m.classList.remove("open");
      return;
    }
    if (t.classList && t.classList.contains("modal")) {
      t.classList.remove("open"); return;
    }
    if (t.id === "addChip" || t.closest("#addChip")) {
      PICK = new Set(SEL);
      renderPickList();
      openModal("#pickModal");
      $("#pickSearch").focus();
      return;
    }
    const drop = t.closest("[data-drop]");
    if (drop) {
      SEL = SEL.filter((e) => e !== drop.dataset.drop);
      save(); renderChips();
      if (SEL.length) load(); else { DATA = null; renderAll(); }
      return;
    }
    const row = t.closest(".prow");
    if (row) {
      const eid = row.dataset.eid;
      if (PICK.has(eid)) PICK.delete(eid);
      else if (PICK.size >= MAX_SERIES) {
        toast("Up to " + MAX_SERIES + " series at a time — remove one first. " +
          "More than that and the chart stops being readable.", true);
        return;
      } else PICK.add(eid);
      renderPickList();
      return;
    }
    const leg = t.closest("[data-toggle]");
    if (leg) {
      const eid = leg.dataset.toggle;
      if (HIDDEN.has(eid)) HIDDEN.delete(eid); else HIDDEN.add(eid);
      renderChart(); renderLegend();
      return;
    }
    const q = t.closest("#quick button");
    if (q) { setQuick(q.dataset.q); load(); return; }

    if (t.id === "pickDone") {
      SEL = [...PICK];
      save(); renderChips(); closeModal("#pickModal");
      load();
      return;
    }
    if (t.id === "clearSel") {
      SEL = []; save(); renderChips(); DATA = null; renderAll(); return;
    }
    if (t.id === "runBtn") { load(); return; }
    if (t.id === "helpBtn") { openModal("#helpModal"); return; }
    if (t.id === "csvBtn") {
      if (!SEL.length) { toast("Pick at least one entity first.", true); return; }
      const a = document.createElement("a");
      a.href = API + "/csv" + queryString();
      a.download = "";
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast("CSV download started.");
      return;
    }
  });

  $("#pickSearch").addEventListener("input", renderPickList);
  ["#fromIn", "#toIn"].forEach((s) => $(s).addEventListener("change", () => {
    QUICK = null;
    $$("#quick button").forEach((b) => b.classList.remove("on"));
    $("#rangeSub").textContent = "custom range";
    load();
  }));
  $("#bucketIn").addEventListener("change", load);

  const wrap = $("#chartWrap");
  wrap.addEventListener("mousemove", onHover);
  wrap.addEventListener("mouseleave", () => {
    $("#hoverBox").style.display = "none";
    const c = document.querySelector("#chartHost .cross");
    if (c) c.remove();
  });
  wrap.addEventListener("touchmove", (ev) => {
    if (ev.touches && ev.touches[0]) onHover(ev.touches[0]);
  }, { passive: true });

  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderChart, 150);
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") $$(".modal.open").forEach((m) => m.classList.remove("open"));
  });

  /* ---------------------------------------------------------- start */

  function save() {
    try { localStorage.setItem("he_sel", JSON.stringify(SEL)); } catch (e) { /* private mode */ }
  }
  function restore() {
    try {
      const raw = JSON.parse(localStorage.getItem("he_sel") || "[]");
      if (Array.isArray(raw)) SEL = raw.slice(0, MAX_SERIES).map(String);
    } catch (e) { SEL = []; }
  }

  restore();
  setQuick("24h");
  renderChips();
  renderAll();
  loadEntities().then(() => { if (SEL.length) load(); });
}

/* Browser: wire everything up. Node (tests): just export the pure helpers. */
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildChartSVG, niceTicks, fmtVal, fmtDur, stateColor, esc };
}
