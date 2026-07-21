/* Energy Center — frontend logic.
 *
 * Talks to /api/tools/energy_center/* (tool.py). Pure vanilla JS, no
 * libraries: the bar charts are plain flexbox divs with CSS animations.
 */
"use strict";

const API = "/api/tools/energy_center";
const $  = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

let CFG = null;          // {price_per_kwh, currency, tracked, labels}
let REPORT = null;       // last /report payload
let RANGE = "today";
let SENSORS = [];        // /sensors payload for the wizard
let WSEL = new Set();    // wizard selection
let WSTEP = 1;
let FIRST_RUN = false;
let loading = false;

/* ------------------------------------------------------------ utils */

async function api(method, path, body) {
  const opt = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) opt.body = JSON.stringify(body);
  const r = await fetch(API + path, opt);
  let data = {};
  try { data = await r.json(); } catch (e) { /* empty body */ }
  if (!r.ok) throw new Error(data.error || data.message || ("HTTP " + r.status));
  return data;
}

function toast(msg, bad) {
  const t = document.createElement("div");
  t.className = "toast" + (bad ? " bad" : "");
  t.textContent = msg;
  $("#toasts").appendChild(t);
  setTimeout(() => t.remove(), bad ? 6000 : 3200);
}

function cur() { return (REPORT && REPORT.currency) || (CFG && CFG.currency) || "$"; }
function price() {
  return (REPORT && REPORT.price_per_kwh) || (CFG && CFG.price_per_kwh) || 0;
}

function fmtNum(v) {
  v = Number(v) || 0;
  if (v >= 1000) return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (v >= 100) return v.toFixed(0);
  if (v >= 10) return v.toFixed(1);
  if (v >= 1) return v.toFixed(2);
  return v.toFixed(3);
}
const fmtKwh = (v) => fmtNum(v) + " kWh";
function fmtCost(v) {
  v = Number(v) || 0;
  const s = v >= 1000
    ? v.toLocaleString(undefined, { maximumFractionDigits: 0 })
    : v.toFixed(2);
  return cur() + s;
}

function bucketLabel(ts, period, full) {
  const d = new Date(ts);
  if (period === "hour") {
    const hm = String(d.getHours()).padStart(2, "0") + ":" +
               String(d.getMinutes()).padStart(2, "0");
    return full
      ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + hm
      : hm;
  }
  return full
    ? d.toLocaleDateString(undefined,
        { weekday: "short", month: "short", day: "numeric" })
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/* ------------------------------------------------------------ tooltip (hints) */

const tipbox = $("#tipbox");
document.addEventListener("mouseover", (e) => {
  const h = e.target.closest(".hint");
  if (!h) { tipbox.style.display = "none"; return; }
  const d = h._hint; if (!d) return;
  tipbox.innerHTML = `<b class="t">${esc(d.t)}</b>${esc(d.b)}` +
    (d.ex ? `<div class="ex">${esc(d.ex)}</div>` : "");
  tipbox.style.display = "block";
  const r = h.getBoundingClientRect(), tw = tipbox.offsetWidth;
  let x = Math.min(r.left, innerWidth - tw - 10);
  let y = r.bottom + 8;
  if (y + tipbox.offsetHeight > innerHeight - 8)
    y = r.top - tipbox.offsetHeight - 8;
  tipbox.style.left = Math.max(8, x) + "px";
  tipbox.style.top = Math.max(8, y) + "px";
});

function hintEl(hint) {
  const s = document.createElement("span");
  s.className = "hint"; s.textContent = "?"; s._hint = hint;
  return s;
}

const HINTS = {
  range: { t: "Time ranges",
    b: "Today and Yesterday show hour-by-hour bars (from local midnight). " +
       "This week starts on Monday, This month on the 1st — both show one " +
       "bar per day. All data comes from HA's long-term statistics, so it " +
       "survives history purges." },
  chart: { t: "Consumption chart",
    b: "Each bar is the combined consumption of all tracked sensors in that " +
       "hour or day. Hover a bar for the exact kWh and cost. Statistics are " +
       "written once an hour, so the current hour appears with a delay." },
  consumers: { t: "Top consumers",
    b: "Your tracked devices ranked by consumption in the selected range. " +
       "The bar is scaled to the biggest consumer. Click a row to see that " +
       "device's own chart and its share of the total." },
  pick: { t: "What is an energy sensor?",
    b: "A sensor measuring cumulative energy in kWh / Wh / MWh — like a " +
       "utility meter, it only counts up. Smart plugs with energy monitoring " +
       "expose one automatically. If a device only reports power (W), " +
       "create an Integral helper first: Helper Maker → New Helper → " +
       "Integral converts W into kWh, then track that new sensor here.",
    ex: "sensor.washing_machine_energy   14.53 kWh" },
  price: { t: "Price per kWh",
    b: "The per-kWh rate from your electricity bill, in your local currency. " +
       "With a tiered or time-of-use tariff, enter your average rate — " +
       "costs shown here are then a close estimate.",
    ex: "0.24  →  10 kWh costs 2.40" },
  currency: { t: "Currency symbol",
    b: "Just for display, shown before every cost. Any short text works: " +
       "$, €, £, kr, T…" },
  dash: { t: "Energy Summary on dashboards",
    b: "When on, dashboards (wall tablets) can show the read-only Energy " +
       "Summary widget: totals, cost and top consumers for a range. Any " +
       "logged-in user with access to that dashboard can see it — nothing " +
       "can be changed from the widget, and results are cached for two " +
       "minutes. Turn it off to keep energy data visible to admins only.",
    ex: "GET /api/dash/energy_center/summary?d=<dashboard>&range=today" },
};

/* ------------------------------------------------------------ modals */

$$(".modal").forEach((m) => {
  m.addEventListener("click", (e) => {
    if (e.target === m || e.target.closest("[data-close]")) closeModal(m);
  });
});
function openModal(id) { $(id).classList.add("open"); }
function closeModal(m) {
  if (typeof m === "string") m = $(m);
  m.classList.remove("open");
}

/* ------------------------------------------------------------ chart */

const bartip = $("#bartip");
document.addEventListener("mousemove", (e) => {
  if (bartip.style.display !== "block") return;
  let x = e.clientX + 14, y = e.clientY + 14;
  if (x + bartip.offsetWidth > innerWidth - 8)
    x = e.clientX - bartip.offsetWidth - 10;
  if (y + bartip.offsetHeight > innerHeight - 8)
    y = e.clientY - bartip.offsetHeight - 10;
  bartip.style.left = x + "px";
  bartip.style.top = y + "px";
});

function renderChart(container, buckets, series, period, mini) {
  container.innerHTML = "";
  if (!buckets.length || !series.length) {
    container.innerHTML = `<div class="chartempty">No data in this range yet.
      <br>Long-term statistics are written once an hour.</div>`;
    return;
  }
  const max = Math.max(...series, 0.000001);
  const chart = document.createElement("div");
  chart.className = "chart" + (mini ? " mini" : "");
  const n = buckets.length;
  const labelEvery = Math.max(1, Math.ceil(n / (mini ? 8 : 14)));
  buckets.forEach((ts, i) => {
    const v = series[i] || 0;
    const col = document.createElement("div");
    col.className = "col";
    const zone = document.createElement("div");
    zone.className = "barzone";
    const bar = document.createElement("div");
    bar.className = "bar" + (v <= 0 ? " zero" : "");
    bar.style.height = Math.max(1.5, (v / max) * 100) + "%";
    bar.style.animationDelay = Math.min(i * 18, 500) + "ms";
    const full = bucketLabel(ts, period, true);
    bar.title = `${full} — ${fmtKwh(v)}`;
    bar.addEventListener("mouseenter", () => {
      bartip.innerHTML = `<b>${esc(full)}</b><br>${esc(fmtKwh(v))}` +
        (price() > 0 ? ` · ${esc(fmtCost(v * price()))}` : "");
      bartip.style.display = "block";
    });
    bar.addEventListener("mouseleave", () => { bartip.style.display = "none"; });
    zone.appendChild(bar);
    const xl = document.createElement("div");
    xl.className = "xl";
    xl.textContent = (i % labelEvery === 0) ? bucketLabel(ts, period, false) : "";
    col.appendChild(zone);
    col.appendChild(xl);
    chart.appendChild(col);
  });
  container.appendChild(chart);
}

/* ------------------------------------------------------------ dashboard */

async function loadReport(silent) {
  if (loading) return;
  loading = true;
  try {
    REPORT = await api("GET", "/report?range=" + encodeURIComponent(RANGE));
  } catch (e) {
    if (!silent) toast("Could not load report: " + e.message, true);
    loading = false;
    renderConn(false);
    return;
  }
  loading = false;
  render();
}

function renderConn(ok) {
  const el = $("#connStat");
  el.innerHTML = `<span class="dot${ok ? " ok" : ""}"></span>` +
    (ok ? "connected" : "not connected");
}

function statCard(icon, label, value, sub, hint) {
  const box = document.createElement("div");
  box.className = "statbox";
  const lbl = document.createElement("span");
  lbl.className = "lbl";
  lbl.textContent = label;
  if (hint) lbl.appendChild(hintEl(hint));
  const b = document.createElement("b");
  b.innerHTML = value;
  box.innerHTML = `<span class="bic">${icon}</span>`;
  box.appendChild(lbl);
  box.appendChild(b);
  if (sub) {
    const s = document.createElement("div");
    s.className = "sub"; s.textContent = sub;
    box.appendChild(s);
  }
  return box;
}

function render() {
  const r = REPORT;
  if (!r) return;
  renderConn(!!r.connected);

  const hasTracked = CFG && CFG.tracked && CFG.tracked.length > 0;
  $("#firstRun").style.display = hasTracked ? "none" : "";
  $("#chartPanel").style.display = hasTracked ? "" : "none";
  $("#consumersPanel").style.display = hasTracked ? "" : "none";
  $("#statCards").style.display = hasTracked ? "" : "none";

  const notice = $("#notice");
  if (r.message && hasTracked) {
    notice.textContent = r.message;
    notice.style.display = "";
  } else {
    notice.style.display = "none";
  }
  if (!hasTracked) return;

  // ---- stat cards
  const cards = $("#statCards");
  cards.innerHTML = "";
  const t = r.totals || {};
  cards.appendChild(statCard("⚡", "Total consumption",
    `${esc(fmtNum(t.kwh))} <small>kWh</small>`));
  cards.appendChild(statCard("💰", "Total cost",
    esc(fmtCost(t.cost)),
    r.price_per_kwh > 0 ? `at ${cur()}${r.price_per_kwh}/kWh`
                        : "set your price in ⚙ Setup"));
  if (r.top) {
    cards.appendChild(statCard("🔥", "Most hungry",
      esc(r.top.name),
      `${fmtKwh(r.top.kwh)} · ${r.top.share}% of total`));
  } else {
    cards.appendChild(statCard("🔥", "Most hungry", "—",
      "no consumption in this range"));
  }
  if (t.avg_per_day != null) {
    cards.appendChild(statCard("📅", "Average per day",
      `${esc(fmtNum(t.avg_per_day))} <small>kWh</small>`,
      `over ${t.days} day${t.days === 1 ? "" : "s"}`));
  } else {
    // today / yesterday: show the peak bucket instead
    let peakI = -1, peakV = 0;
    (r.total_series || []).forEach((v, i) => {
      if (v > peakV) { peakV = v; peakI = i; }
    });
    cards.appendChild(statCard("📈", "Peak hour",
      peakI >= 0 ? `${esc(fmtNum(peakV))} <small>kWh</small>` : "—",
      peakI >= 0 ? "at " + bucketLabel(r.buckets[peakI], "hour", false) : ""));
  }

  // ---- main chart
  const rangeNames = { today: "today", yesterday: "yesterday",
                       week: "this week", month: "this month" };
  $("#chartSub").textContent =
    `${rangeNames[r.range] || r.range} · per ${r.period}`;
  renderChart($("#chart"), r.buckets || [], r.total_series || [], r.period);

  // ---- top consumers
  const list = $("#consumers");
  list.innerHTML = "";
  const sensors = r.sensors || [];
  $("#consumersSub").textContent =
    sensors.length ? `${sensors.length} tracked` : "";
  if (!sensors.length) {
    list.innerHTML = `<div class="empty">No tracked sensors.</div>`;
    return;
  }
  const maxKwh = Math.max(...sensors.map((s) => s.total_kwh), 0.000001);
  sensors.forEach((s, i) => {
    const row = document.createElement("div");
    row.className = "crow";
    row.innerHTML = `
      <div class="rank">${i + 1}</div>
      <div class="cinfo">
        <div class="cn">${esc(s.name)}</div>
        <div class="ctrack"><div class="cbar"></div></div>
      </div>
      <div class="cnum">
        <b>${esc(fmtKwh(s.total_kwh))}</b>
        <span>${r.price_per_kwh > 0 ? esc(fmtCost(s.cost)) : (s.share + "%")}</span>
      </div>`;
    row.addEventListener("click", () => openDrill(s));
    list.appendChild(row);
    const w = Math.max(2, (s.total_kwh / maxKwh) * 100);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => { $(".cbar", row).style.width = w + "%"; }));
  });
}

/* ------------------------------------------------------------ drill-down */

function openDrill(s) {
  const r = REPORT;
  $("#drillTitle").textContent = s.name;
  $("#drillSub").innerHTML =
    `<span style="font-family:Consolas,monospace">${esc(s.id)}</span>`;
  const stats = $("#drillStats");
  stats.innerHTML = "";
  stats.appendChild(statCard("⚡", "Consumption",
    `${esc(fmtNum(s.total_kwh))} <small>kWh</small>`));
  stats.appendChild(statCard("💰", "Cost",
    r.price_per_kwh > 0 ? esc(fmtCost(s.cost)) : "—",
    r.price_per_kwh > 0 ? "" : "set your price in ⚙ Setup"));
  stats.appendChild(statCard("🍰", "Share", esc(s.share) + " <small>%</small>",
    "of everything tracked"));
  $("#drillShareLbl").textContent =
    `${s.share}% of the ${fmtKwh(r.totals.kwh)} total in this range`;
  const bar = $("#drillShareBar");
  bar.style.width = "0";
  renderChart($("#drillChart"), r.buckets || [], s.series || [], r.period, true);
  openModal("#drillModal");
  requestAnimationFrame(() =>
    requestAnimationFrame(() => { bar.style.width = s.share + "%"; }));
}

/* ------------------------------------------------------------ setup wizard */

async function openWizard(firstRun) {
  FIRST_RUN = !!firstRun;
  WSTEP = 1;
  WSEL = new Set((CFG && CFG.tracked) || []);
  $("#wizTitle").textContent =
    FIRST_RUN ? "Welcome — let's set things up" : "Energy Center setup";
  $("#wizSub").textContent = FIRST_RUN
    ? "Two quick steps: pick the sensors that measure energy (kWh), then " +
      "tell me what a kWh costs you. You can change everything later " +
      "with the ⚙ Setup button."
    : "Pick tracked sensors, then review your price and currency.";
  $("#priceInput").value = CFG && CFG.price_per_kwh ? CFG.price_per_kwh : "";
  $("#curInput").value = (CFG && CFG.currency) || "$";
  $("#dashToggle").checked = !CFG || CFG.allow_dashboards !== false;
  $("#sensSearch").value = "";
  $("#wizErr").style.display = "none";
  showWizStep();
  openModal("#setupModal");

  $("#sensList").innerHTML = `<div class="empty">Loading energy sensors…</div>`;
  try {
    const d = await api("GET", "/sensors");
    SENSORS = d.sensors || [];
    if (!d.connected) {
      $("#sensList").innerHTML =
        `<div class="empty">⏳ ${esc(d.message || "Not connected to Home Assistant yet.")}</div>`;
      return;
    }
  } catch (e) {
    $("#sensList").innerHTML =
      `<div class="empty">Could not load sensors: ${esc(e.message)}</div>`;
    return;
  }
  renderSensorList();
}

function renderSensorList() {
  const q = $("#sensSearch").value.trim().toLowerCase();
  const list = $("#sensList");
  list.innerHTML = "";
  const shown = SENSORS.filter((s) =>
    !q || s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q));
  if (!SENSORS.length) {
    list.innerHTML = `<div class="empty"><span class="big">🔍</span>
      No energy sensors found yet.<br>
      Smart plugs with energy monitoring add them automatically — or build a
      kWh sensor from any power (W) sensor with an <b>Integral</b> helper in
      Helper Maker. Hover the <b>?</b> above for details.</div>`;
    return;
  }
  if (!shown.length) {
    list.innerHTML = `<div class="empty">Nothing matches "${esc(q)}".</div>`;
    return;
  }
  shown.forEach((s) => {
    const row = document.createElement("div");
    row.className = "srow" + (WSEL.has(s.id) ? " sel" : "");
    const val = (s.state != null && s.state !== "unavailable" &&
                 s.state !== "unknown")
      ? `${esc(s.state)} ${esc(s.unit)}` : "";
    row.innerHTML = `
      <div class="cb">${WSEL.has(s.id) ? "✓" : ""}</div>
      <div class="sn"><b>${esc(s.name)}</b>
        <div class="sid">${esc(s.id)}</div></div>
      <span class="val">${val}</span>
      <span class="ubadge">${esc(s.unit)}</span>`;
    row.addEventListener("click", () => {
      if (WSEL.has(s.id)) WSEL.delete(s.id); else WSEL.add(s.id);
      row.classList.toggle("sel", WSEL.has(s.id));
      $(".cb", row).textContent = WSEL.has(s.id) ? "✓" : "";
      updateSelCount();
    });
    list.appendChild(row);
  });
  updateSelCount();
}

function updateSelCount() {
  $("#selCount").textContent = WSEL.size + " selected";
}

function showWizStep() {
  $("#wizPage1").style.display = WSTEP === 1 ? "" : "none";
  $("#wizPage2").style.display = WSTEP === 2 ? "" : "none";
  $("#wstep1").classList.toggle("on", WSTEP === 1);
  $("#wstep2").classList.toggle("on", WSTEP === 2);
  $("#wizBack").style.display = WSTEP === 2 ? "" : "none";
  $("#wizNext").textContent = WSTEP === 1 ? "Next →" : "✓ Save";
}

function wizErr(msg) {
  const e = $("#wizErr");
  e.textContent = msg;
  e.style.display = "";
}

async function wizNext() {
  $("#wizErr").style.display = "none";
  if (WSTEP === 1) {
    if (!WSEL.size) { wizErr("Pick at least one energy sensor to track."); return; }
    WSTEP = 2;
    showWizStep();
    return;
  }
  const priceRaw = $("#priceInput").value.trim();
  const p = priceRaw === "" ? 0 : Number(priceRaw);
  if (isNaN(p) || p < 0) { wizErr("Price per kWh must be a number ≥ 0."); return; }
  const c = $("#curInput").value.trim() || "$";
  const btn = $("#wizNext");
  btn.disabled = true;
  try {
    const d = await api("POST", "/config",
      { tracked: [...WSEL], price_per_kwh: p, currency: c,
        allow_dashboards: $("#dashToggle").checked });
    CFG = d.config;
  } catch (e) {
    btn.disabled = false;
    wizErr("Could not save: " + e.message);
    return;
  }
  btn.disabled = false;
  closeModal("#setupModal");
  toast(`Saved — tracking ${CFG.tracked.length} sensor${CFG.tracked.length === 1 ? "" : "s"} ⚡`);
  loadReport();
}

/* ------------------------------------------------------------ init */

function placeHints() {
  $("#rangeHint").appendChild(hintEl(HINTS.range));
  $("#chartHint").appendChild(hintEl(HINTS.chart));
  $("#consumersHint").appendChild(hintEl(HINTS.consumers));
  $("#pickHint").appendChild(hintEl(HINTS.pick));
  $("#priceHint").appendChild(hintEl(HINTS.price));
  $("#curHint").appendChild(hintEl(HINTS.currency));
  $("#dashHint").appendChild(hintEl(HINTS.dash));
}

async function init() {
  placeHints();

  $$("#rangeTabs button").forEach((b) => {
    b.addEventListener("click", () => {
      $$("#rangeTabs button").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      RANGE = b.dataset.range;
      loadReport();
    });
  });
  $("#refreshBtn").addEventListener("click", () => {
    loadReport();
    toast("Refreshed ↻");
  });
  $("#setupBtn").addEventListener("click", () => openWizard(false));
  $("#firstRunBtn").addEventListener("click", () => openWizard(true));
  $("#learnBtn").addEventListener("click", () => openModal("#learnModal"));
  $("#wizNext").addEventListener("click", wizNext);
  $("#wizBack").addEventListener("click", () => {
    WSTEP = 1; showWizStep(); $("#wizErr").style.display = "none";
  });
  $("#selNone").addEventListener("click", () => {
    WSEL.clear(); renderSensorList();
  });
  $("#sensSearch").addEventListener("input", renderSensorList);

  try {
    CFG = await api("GET", "/config");
  } catch (e) {
    toast("Could not load config: " + e.message, true);
    CFG = { price_per_kwh: 0, currency: "$", tracked: [], labels: {},
            allow_dashboards: true };
  }

  if (!CFG.tracked.length) {
    $("#firstRun").style.display = "";
    $("#chartPanel").style.display = "none";
    $("#consumersPanel").style.display = "none";
    $("#statCards").style.display = "none";
    renderConn(true);
    openWizard(true);
  } else {
    await loadReport();
  }

  setInterval(() => { if (!document.hidden) loadReport(true); }, 60000);
}

init();
